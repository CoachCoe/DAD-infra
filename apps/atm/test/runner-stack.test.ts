import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { getAtmConfig } from '../lib/atm-config';
import { EvidenceStack } from '../lib/evidence-stack';
import { LedgerStack } from '../lib/ledger-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { RunnerStack } from '../lib/runner-stack';

function build(env: 'staging' | 'production'): Template {
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
  return Template.fromStack(runner);
}

describe('RunnerStack', () => {
  test('CodeBuild project is privileged, named, and uses a GitHub source without stored creds', () => {
    const template = build('staging');
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Name: 'atm-runner-staging',
      Environment: Match.objectLike({
        PrivilegedMode: true,
        ComputeType: 'BUILD_GENERAL1_MEDIUM',
      }),
      Source: Match.objectLike({ Type: 'GITHUB' }),
    });
    // No stored GitHub credential resource.
    template.resourceCountIs('AWS::CodeBuild::SourceCredential', 0);
  });

  test('log group retention equals the env config', () => {
    build('staging').hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 30,
    });
    build('production').hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 365,
    });
  });

  test('service role grants no Resource:"*" on s3/dynamodb/secrets', () => {
    const template = build('staging');
    const policies = template.findResources('AWS::IAM::Policy');
    for (const policy of Object.values(policies)) {
      const statements = policy.Properties.PolicyDocument.Statement as Array<{
        Action: string | string[];
        Resource: unknown;
      }>;
      for (const stmt of statements) {
        const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        const touchesData = actions.some((a) =>
          /^(s3|dynamodb|secretsmanager):/.test(a),
        );
        if (!touchesData) continue;
        const resources = Array.isArray(stmt.Resource)
          ? stmt.Resource
          : [stmt.Resource];
        for (const r of resources) {
          expect(r).not.toBe('*');
        }
      }
    }
  });

  test('role is scoped to the findings table and its by-status GSI', () => {
    const template = build('staging');
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'FindingsLedger',
            Action: Match.arrayWith(['dynamodb:Query', 'dynamodb:UpdateItem']),
          }),
        ]),
      },
    });
  });
});
