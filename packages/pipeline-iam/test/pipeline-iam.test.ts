import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as iam from 'aws-cdk-lib/aws-iam';
import {
  GitHubOidcProvider,
  githubEnvironmentPrincipal,
  githubEnvironmentSubject,
  scopedDeployRole,
  GITHUB_OIDC_URL,
  OIDC_AUDIENCE,
} from '../src/index';

describe('GitHubOidcProvider', () => {
  test('creates the provider with the GitHub issuer URL and STS audience', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new GitHubOidcProvider(stack, 'Oidc');

    const template = Template.fromStack(stack);
    template.hasResourceProperties('Custom::AWSCDKOpenIdConnectProvider', {
      Url: GITHUB_OIDC_URL,
      ClientIDList: [OIDC_AUDIENCE],
    });
  });
});

describe('githubEnvironmentSubject', () => {
  test('is the sub claim GitHub issues to a job under a GitHub Environment', () => {
    expect(githubEnvironmentSubject('CoachCoe/DAD-infra', 'staging')).toBe(
      'repo:CoachCoe/DAD-infra:environment:staging',
    );
    expect(githubEnvironmentSubject('CoachCoe/DAD-Main', 'production')).toBe(
      'repo:CoachCoe/DAD-Main:environment:production',
    );
  });
});

describe('githubEnvironmentPrincipal', () => {
  test('pins aud and an exact (non-wildcard) sub, with no StringLike', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const oidc = new GitHubOidcProvider(stack, 'Oidc');
    new iam.Role(stack, 'R', {
      roleName: 'env-role',
      assumedBy: githubEnvironmentPrincipal(oidc.provider, 'CoachCoe/DAD-infra', 'production'),
    });
    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'env-role',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': OIDC_AUDIENCE,
                'token.actions.githubusercontent.com:sub':
                  'repo:CoachCoe/DAD-infra:environment:production',
              },
            },
          }),
        ],
      },
    });
  });
});

describe('scopedDeployRole', () => {
  test('trusts exactly the repo\'s GitHub Environment: aud pinned, exact sub, no wildcard', () => {
    for (const env of ['staging', 'production'] as const) {
      const app = new App();
      const stack = new Stack(app, 'TestStack');
      const oidc = new GitHubOidcProvider(stack, 'Oidc');
      scopedDeployRole(stack, 'DeployRole', {
        provider: oidc.provider,
        repo: 'CoachCoe/DAD-Main',
        env,
        roleName: 'test-deploy',
      });
      Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
        RoleName: 'test-deploy',
        AssumeRolePolicyDocument: {
          Statement: [
            Match.objectLike({
              Action: 'sts:AssumeRoleWithWebIdentity',
              Condition: {
                StringEquals: {
                  'token.actions.githubusercontent.com:aud': OIDC_AUDIENCE,
                  'token.actions.githubusercontent.com:sub': `repo:CoachCoe/DAD-Main:environment:${env}`,
                },
              },
            }),
          ],
        },
      });
    }
  });

  test('the package exports no branch or tag trust helper', () => {
    const exported = Object.keys(require('../src/index'));
    expect(exported).not.toContain('githubSubjectConditions');
    expect(exported).not.toContain('githubOidcPrincipal');
  });
});
