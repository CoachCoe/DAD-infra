import { Template, Match } from 'aws-cdk-lib/assertions';
import { buildGraph } from './helpers';

describe('PipelineIamStack', () => {
  it('creates the GitHub OIDC provider', () => {
    const t = Template.fromStack(buildGraph('staging').pipelineIam);
    t.hasResourceProperties('Custom::AWSCDKOpenIdConnectProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIDList: ['sts.amazonaws.com'],
    });
  });

  it('creates two deploy roles (infra + app) scoped to the repo/branch', () => {
    const t = Template.fromStack(buildGraph('staging').pipelineIam);
    for (const name of ['dad-staging-infra-deploy', 'dad-staging-app-deploy']) {
      t.hasResourceProperties('AWS::IAM::Role', { RoleName: name });
    }
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: Match.objectLike({
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  'repo:dynamicaid/dad:ref:refs/heads/dev',
                ],
              },
            }),
          }),
        ]),
      },
    });
  });

  it('lets app-deploy read only this env\'s dad-* stack outputs (deploy.yml resolves names from them)', () => {
    for (const [env, account] of [
      ['staging', '853377042897'],
      ['production', '216833405626'],
    ] as const) {
      const t = Template.fromStack(buildGraph(env).pipelineIam);
      t.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: 'ReadStackOutputs',
              Effect: 'Allow',
              Action: 'cloudformation:DescribeStacks',
              Resource: `arn:aws:cloudformation:us-east-2:${account}:stack/dad-*-${env}/*`,
            }),
          ]),
        },
        Roles: [{ Ref: Match.stringLikeRegexp('AppDeployRole') }],
      });
    }
  });
  it('production scopes the sub to the production GitHub Environment', () => {
    const t = Template.fromStack(buildGraph('production').pipelineIam);
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: Match.objectLike({
              StringLike: {
                'token.actions.githubusercontent.com:sub': Match.arrayWith([
                  'repo:dynamicaid/dad:environment:production',
                ]),
              },
            }),
          }),
        ]),
      },
    });
  });
});
