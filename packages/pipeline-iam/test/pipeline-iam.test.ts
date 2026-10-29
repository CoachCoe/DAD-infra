import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import {
  GitHubOidcProvider,
  githubSubjectConditions,
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

describe('githubSubjectConditions', () => {
  test('staging trusts the dev branch only', () => {
    expect(githubSubjectConditions('CoachCoe/DAD-Main', 'staging')).toEqual([
      'repo:CoachCoe/DAD-Main:ref:refs/heads/dev',
    ]);
  });

  test('production trusts the production environment and release tags', () => {
    expect(githubSubjectConditions('CoachCoe/DAD-Main', 'production')).toEqual([
      'repo:CoachCoe/DAD-Main:environment:production',
      'repo:CoachCoe/DAD-Main:ref:refs/tags/*',
    ]);
  });
});

describe('scopedDeployRole', () => {
  test('mints a role whose trust pins aud=sts and the env subject', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const oidc = new GitHubOidcProvider(stack, 'Oidc');
    scopedDeployRole(stack, 'DeployRole', {
      provider: oidc.provider,
      repo: 'CoachCoe/DAD-Main',
      env: 'staging',
      roleName: 'test-deploy',
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'test-deploy',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': OIDC_AUDIENCE,
              },
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  'repo:CoachCoe/DAD-Main:ref:refs/heads/dev',
                ],
              },
            },
          }),
        ]),
      },
    });
  });
});
