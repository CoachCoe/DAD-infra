import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import {
  GitHubOidcProvider,
  githubEnvironmentPrincipal,
} from '@dad-infra/pipeline-iam';
import { EnvConfig } from './config';

/** The repo whose workflow runs `cdk deploy` for this app (dad-main-infra.yml). */
export const DAD_INFRA_REPO = 'CoachCoe/DAD-infra';
/** The repo whose workflow rolls the application out (deploy.yml). */
export const DAD_MAIN_REPO = 'CoachCoe/DAD-Main';

/** Props for {@link PipelineIamStack}. */
export interface PipelineIamStackProps extends cdk.StackProps {
  readonly config: EnvConfig;
  /**
   * GitHub `owner/repo` the infra-deploy role trusts. Falls back to CDK context
   * `infraRepo`, then {@link DAD_INFRA_REPO}.
   */
  readonly infraRepo?: string;
  /**
   * GitHub `owner/repo` the app-deploy role trusts. Falls back to CDK context
   * `appRepo`, then {@link DAD_MAIN_REPO}.
   */
  readonly appRepo?: string;
}

/**
 * PipelineIamStack (PLAN item 11).
 *
 * The GitHub Actions OIDC provider (token.actions.githubusercontent.com) and
 * two env-scoped deploy roles:
 *   - infra-deploy → runs `cdk deploy` for this env (infra pipeline).
 *   - app-deploy   → builds/pushes images and runs `aws ecs update-service`
 *                    (app pipeline).
 *
 * Each role trusts a different repo, because a different repo's workflow assumes it:
 *   - infra-deploy ← DAD-infra   (dad-main-infra.yml)
 *   - app-deploy   ← DAD-Main    (deploy.yml)
 * and each trusts exactly that repo's GitHub Environment (`staging` / `production`),
 * because every deploy job runs under one and GitHub then issues
 * `sub = repo:<repo>:environment:<env>`. Restrict which branches and tags may deploy
 * to those environments in the repository settings. Documented as a one-time
 * per-account apply.
 */
export class PipelineIamStack extends cdk.Stack {
  public readonly provider: iam.OpenIdConnectProvider;
  public readonly infraDeployRole: iam.Role;
  public readonly appDeployRole: iam.Role;

  constructor(scope: Construct, id: string, props: PipelineIamStackProps) {
    super(scope, id, props);

    const { config } = props;
    const infraRepo =
      props.infraRepo ??
      (this.node.tryGetContext('infraRepo') as string | undefined) ??
      DAD_INFRA_REPO;
    const appRepo =
      props.appRepo ??
      (this.node.tryGetContext('appRepo') as string | undefined) ??
      DAD_MAIN_REPO;

    // The account-level OIDC provider comes from the shared package so the two
    // DAD apps (dad-main, atm) do not each mint a colliding provider. The
    // construct id 'GitHubOidc' is preserved so the synthesized resource shape
    // is unchanged.
    this.provider = new GitHubOidcProvider(this, 'GitHubOidc').provider;

    // infra-deploy: allowed to assume the CDK bootstrap roles for cdk deploy.
    this.infraDeployRole = new iam.Role(this, 'InfraDeployRole', {
      roleName: `dad-${config.env}-infra-deploy`,
      assumedBy: githubEnvironmentPrincipal(this.provider, infraRepo, config.env),
      description: `GitHub OIDC infra (cdk deploy) role for ${config.env}.`,
      maxSessionDuration: cdk.Duration.hours(1),
    });
    this.infraDeployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${config.account}:role/cdk-*-deploy-role-*`,
          `arn:aws:iam::${config.account}:role/cdk-*-file-publishing-role-*`,
          `arn:aws:iam::${config.account}:role/cdk-*-image-publishing-role-*`,
          `arn:aws:iam::${config.account}:role/cdk-*-lookup-role-*`,
        ],
      }),
    );

    // app-deploy: build/push images to ECR + direct ECS deploy (scripts/deploy.sh).
    this.appDeployRole = new iam.Role(this, 'AppDeployRole', {
      roleName: `dad-${config.env}-app-deploy`,
      assumedBy: githubEnvironmentPrincipal(this.provider, appRepo, config.env),
      description: `GitHub OIDC app (ECR push + ecs update-service) role for ${config.env}.`,
      maxSessionDuration: cdk.Duration.hours(1),
    });
    this.appDeployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrPush',
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:PutImage',
          'ecr:BatchGetImage',
        ],
        resources: ['*'],
      }),
    );
    this.appDeployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsDeploy',
        actions: [
          'ecs:UpdateService',
          'ecs:DescribeServices',
          'ecs:RegisterTaskDefinition',
          'ecs:RunTask',
          'ecs:DescribeTasks',
          'ecs:ListTasks',
        ],
        resources: ['*'],
      }),
    );
    this.appDeployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PassTaskRoles',
        actions: ['iam:PassRole'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
        },
      }),
    );
    // DAD-Main's deploy.yml resolves the cluster, compute subnets, and workers
    // security group from the CloudFormation outputs these stacks publish
    // (`aws cloudformation describe-stacks --stack-name dad-<name>-<env>`). Read-only,
    // and limited to this environment's dad-* stacks.
    this.appDeployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadStackOutputs',
        actions: ['cloudformation:DescribeStacks'],
        resources: [
          `arn:aws:cloudformation:${config.region}:${config.account}:stack/dad-*-${config.env}/*`,
        ],
      }),
    );

    new cdk.CfnOutput(this, 'OidcProviderArn', {
      value: this.provider.openIdConnectProviderArn,
    });
    new cdk.CfnOutput(this, 'InfraDeployRoleArn', {
      value: this.infraDeployRole.roleArn,
    });
    new cdk.CfnOutput(this, 'AppDeployRoleArn', {
      value: this.appDeployRole.roleArn,
    });
  }
}
