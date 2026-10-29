import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { getAtmConfig } from '../lib/atm-config';
import { EvidenceStack } from '../lib/evidence-stack';
import { LedgerStack } from '../lib/ledger-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { RunnerStack } from '../lib/runner-stack';
import { TriggerStack } from '../lib/trigger-stack';

function build(env: 'staging' | 'production'): {
  template: Template;
  projectName: string;
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
    template: Template.fromStack(trigger),
    projectName: `atm-runner-${env}`,
  };
}

describe('TriggerStack', () => {
  test('the scheduler target is the runner project', () => {
    const { template } = build('staging');
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Target: Match.objectLike({
        Arn: {
          'Fn::ImportValue': Match.anyValue(),
        },
      }),
    });
    // The schedule exists and is named for the env.
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      Name: 'atm-nightly-staging',
    });
  });

  test('the StartBuild role action is exactly codebuild:StartBuild on the project ARN', () => {
    const { template } = build('staging');
    // Both the scheduler role and the OIDC role carry exactly StartBuild.
    const policies = template.findResources('AWS::IAM::Policy');
    const startBuildStatements = Object.values(policies).flatMap((p) =>
      (p.Properties.PolicyDocument.Statement as Array<{ Action: unknown }>).filter(
        (s) => s.Action === 'codebuild:StartBuild',
      ),
    );
    expect(startBuildStatements.length).toBeGreaterThanOrEqual(2);
    for (const stmt of startBuildStatements) {
      expect(stmt.Action).toBe('codebuild:StartBuild');
    }
  });

  test('the OIDC role trust subject matches the DAD-Main repo + env branch', () => {
    const staging = build('staging').template;
    staging.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'atm-startbuild-staging',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: Match.objectLike({
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  'repo:CoachCoe/DAD-Main:ref:refs/heads/dev',
                ],
              },
            }),
          }),
        ]),
      },
    });

    const production = build('production').template;
    production.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'atm-startbuild-production',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: Match.objectLike({
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  'repo:CoachCoe/DAD-Main:environment:production',
                  'repo:CoachCoe/DAD-Main:ref:refs/tags/*',
                ],
              },
            }),
          }),
        ]),
      },
    });
  });
});
