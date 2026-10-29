import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import {
  GitHubOidcProvider,
  scopedDeployRole,
} from '@dad-infra/pipeline-iam';
import { AtmEnvConfig } from './atm-config';

/** Props for {@link TriggerStack}. */
export interface TriggerStackProps extends cdk.StackProps {
  readonly config: AtmEnvConfig;
  /** The CodeBuild runner project the triggers start. */
  readonly project: codebuild.IProject;
  /** Cron/rate schedule for nightly/periodic runs. Defaults to nightly 07:00 UTC. */
  readonly scheduleExpression?: string;
}

/**
 * TriggerStack (PLAN item 1.6).
 *
 * Two ways to start an ATM run:
 *   1. EventBridge Scheduler — nightly/periodic runs. A scheduler-assumed role
 *      is scoped to `codebuild:StartBuild` on exactly this project.
 *   2. GitHub OIDC deploy role — DAD-Main CI assumes it on push/dispatch and is
 *      permitted ONLY `codebuild:StartBuild` on this project. Trust subject is
 *      scoped to the DAD-Main repo + the per-env branch/environment.
 *
 * No AWS-side webhook or public ingress.
 */
export class TriggerStack extends cdk.Stack {
  public readonly oidcStartBuildRole: iam.Role;
  public readonly schedulerRole: iam.Role;

  constructor(scope: Construct, id: string, props: TriggerStackProps) {
    super(scope, id, props);

    const { config, project } = props;

    // --- EventBridge Scheduler: nightly/periodic runs -----------------------
    this.schedulerRole = new iam.Role(this, 'SchedulerRole', {
      roleName: `${config.prefix}-scheduler-${config.env}`,
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: `Lets EventBridge Scheduler start the ${config.prefix} runner (${config.env}).`,
    });
    this.schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'StartRunnerBuild',
        actions: ['codebuild:StartBuild'],
        resources: [project.projectArn],
      }),
    );

    new scheduler.CfnSchedule(this, 'NightlySchedule', {
      name: `${config.prefix}-nightly-${config.env}`,
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: props.scheduleExpression ?? 'cron(0 7 * * ? *)',
      target: {
        arn: project.projectArn,
        roleArn: this.schedulerRole.roleArn,
      },
    });

    // --- GitHub OIDC role assumed by DAD-Main CI to start a run -------------
    const oidc = new GitHubOidcProvider(this, 'GitHubOidc');
    this.oidcStartBuildRole = scopedDeployRole(this, 'DadMainStartBuildRole', {
      provider: oidc.provider,
      repo: config.githubRepo,
      env: config.env,
      roleName: `${config.prefix}-startbuild-${config.env}`,
      description: `DAD-Main CI OIDC role: StartBuild on ${config.prefix}-runner-${config.env} only.`,
    });
    this.oidcStartBuildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'StartRunnerBuild',
        actions: ['codebuild:StartBuild'],
        resources: [project.projectArn],
      }),
    );

    new cdk.CfnOutput(this, 'StartBuildRoleArn', {
      value: this.oidcStartBuildRole.roleArn,
      description: 'OIDC role ARN DAD-Main CI assumes to start an ATM run.',
    });
    new cdk.CfnOutput(this, 'RunnerProjectName', {
      value: project.projectName,
      description: 'ATM CodeBuild runner project name the triggers target.',
    });
  }
}
