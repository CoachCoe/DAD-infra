import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { getAtmConfig } from '../lib/atm-config';
import { EvidenceStack } from '../lib/evidence-stack';
import { LedgerStack } from '../lib/ledger-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { RunnerStack } from '../lib/runner-stack';
import { TriggerStack } from '../lib/trigger-stack';

function build(env: 'staging' | 'production'): {
  stacks: Record<string, cdk.Stack>;
  trigger: Template;
} {
  const app = new cdk.App();
  const config = getAtmConfig(env);
  const cdkEnv = { account: '111111111111', region: 'us-east-2' };
  const evidence = new EvidenceStack(app, `atm-evidence-${env}`, {
    env: cdkEnv,
    config,
  });
  const ledger = new LedgerStack(app, `atm-ledger-${env}`, { env: cdkEnv, config });
  const secrets = new SecretsStack(app, `atm-secrets-${env}`, {
    env: cdkEnv,
    config,
  });
  const runner = new RunnerStack(app, `atm-runner-${env}`, {
    env: cdkEnv,
    config,
    evidenceBucket: evidence.bucket,
    findingsTable: ledger.table,
    secrets: [secrets.openai, secrets.tinker],
  });
  const trigger = new TriggerStack(app, `atm-trigger-${env}`, {
    env: cdkEnv,
    config,
    project: runner.project,
  });
  return {
    stacks: { evidence, ledger, secrets, runner, trigger },
    trigger: Template.fromStack(trigger),
  };
}

describe('TriggerStack', () => {
  test('the scheduler target is the runner project', () => {
    const { trigger } = build('staging');
    trigger.hasResourceProperties('AWS::Scheduler::Schedule', {
      Target: Match.objectLike({
        Arn: {
          'Fn::ImportValue': Match.anyValue(),
        },
      }),
    });
    trigger.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'atm-nightly-staging',
    });
  });

  test('the only way to start a run is the scheduler role, limited to StartBuild on the project', () => {
    for (const env of ['staging', 'production'] as const) {
      const { trigger } = build(env);
      const roles = trigger.findResources('AWS::IAM::Role');
      expect(Object.keys(roles)).toHaveLength(1);
      trigger.hasResourceProperties('AWS::IAM::Role', {
        RoleName: `atm-scheduler-${env}`,
        AssumeRolePolicyDocument: {
          Statement: [
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Principal: { Service: 'scheduler.amazonaws.com' },
            }),
          ],
        },
      });
      const statements = Object.values(trigger.findResources('AWS::IAM::Policy')).flatMap(
        (p) => p.Properties.PolicyDocument.Statement as Array<{ Action: unknown }>,
      );
      expect(statements).toHaveLength(1);
      expect(statements[0].Action).toBe('codebuild:StartBuild');
    }
  });

  // DAD-Main CI deliberately cannot start a run yet (see trigger-stack.ts), and an
  // account has exactly one GitHub OIDC provider, which apps/dad-main owns. Two stacks
  // creating it would fail the second deploy.
  test('creates no GitHub OIDC provider and no web-identity role in any atm stack', () => {
    const offenders: string[] = [];
    for (const env of ['staging', 'production'] as const) {
      const { stacks } = build(env);
      for (const [name, stack] of Object.entries(stacks)) {
        const t = Template.fromStack(stack);
        if (Object.keys(t.findResources('Custom::AWSCDKOpenIdConnectProvider')).length > 0) {
          offenders.push(`${name} (${env}): creates an OIDC provider`);
        }
        if (JSON.stringify(t.toJSON()).includes('sts:AssumeRoleWithWebIdentity')) {
          offenders.push(`${name} (${env}): trusts web identities`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
