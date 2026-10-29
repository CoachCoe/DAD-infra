import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { GitHubOidcProvider, githubOidcPrincipal } from '@dad-infra/pipeline-iam';
import { EnvConfig } from './config';

/** Props for {@link PipelineIamStack}. */
export interface PipelineIamStackProps extends cdk.StackProps {
  readonly config: EnvConfig;
  /**
   * GitHub `owner/repo` the deploy roles trust. Comes from CDK context
   * `githubRepo`, defaulting to the DAD repo slug.
   */
  readonly githubRepo?: string;
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
 * Trust is least-privilege: the OIDC `sub` claim is pinned to the repo and the
 * branch (staging ← dev) or GitHub Environment (production). Documented as a
 * one-time per-account apply.
 */
export class PipelineIamStack extends cdk.Stack {
  public readonly provider: iam.OpenIdConnectProvider;
  public readonly infraDeployRole: iam.Role;
  public readonly appDeployRole: iam.Role;

  constructor(scope: Construct, id: string, props: PipelineIamStackProps) {
    super(scope, id, props);

    const { config } = props;
    const repo =
      props.githubRepo ??
      (this.node.tryGetContext('githubRepo') as string | undefined) ??
      'dynamicaid/dad';

    // The account-level OIDC provider comes from the shared package so the two
    // DAD apps (dad-main, atm) do not each mint a colliding provider. The
    // construct id 'GitHubOidc' is preserved so the synthesized resource shape
    // is unchanged.
    this.provider = new GitHubOidcProvider(this, 'GitHubOidc').provider;

    // Staging is gated by the `dev` branch; production by the GitHub
    // Environment of the same name (via the `environment:<name>` sub claim).
    // The shared helper yields the exact same aud/sub trust conditions.
    const principal = githubOidcPrincipal(this.provider, repo, config.env);

    // infra-deploy: allowed to assume the CDK bootstrap roles for cdk deploy.
    this.infraDeployRole = new iam.Role(this, 'InfraDeployRole', {
      roleName: `dad-${config.env}-infra-deploy`,
      assumedBy: principal,
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
      assumedBy: principal,
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
