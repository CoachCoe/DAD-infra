/**
 * atm-specific environment configuration.
 *
 * Imports the shared DAD account/region core from `@dad-infra/config` and
 * extends it with the fields the ATM-on-AWS stacks need: resource-name prefix,
 * evidence retention, CodeBuild sizing + timeout, DynamoDB billing, deletion
 * protection, and the DAD-Main GitHub repo slug the runner clones.
 *
 * Resolved design decisions (see docs/design/aws-infra-design.md and the task
 * build note):
 *   - evidence retention: staging 90 days, production 365 days
 *   - DynamoDB billing: on-demand (PAY_PER_REQUEST) — spiky commit-triggered load
 *   - GitHub read for the CodeBuild clone: an optional GITHUB_APP_TOKEN supplied by
 *     whoever calls StartBuild (NOT a stored CodeBuild GitHub connection). Scheduled
 *     runs supply none and clone anonymously, which works only while DAD-Main is public.
 */
import {
  type EnvConfig as SharedEnvConfig,
  type EnvName,
  getConfig as getSharedConfig,
} from '@dad-infra/config';
import { Duration, aws_codebuild as codebuild } from 'aws-cdk-lib';

export type { EnvName };

/** The DAD-Main GitHub repo slug the runner clones. */
export const DAD_MAIN_REPO = 'CoachCoe/DAD-Main';

/** Resource-name prefix for every atm resource. */
export const RESOURCE_PREFIX = 'atm';

/** Fully-resolved atm configuration for a single environment. */
export interface AtmEnvConfig extends SharedEnvConfig {
  /** Resource-name prefix (`atm`). */
  readonly prefix: string;
  /** S3 evidence object-expiry window, in days. */
  readonly evidenceRetentionDays: number;
  /** CloudWatch log retention for the runner, in days. */
  readonly logRetentionDays: number;
  /** CodeBuild compute size for the runner. */
  readonly computeType: codebuild.ComputeType;
  /** CodeBuild build timeout. */
  readonly buildTimeout: Duration;
  /** DynamoDB billing mode (on-demand). */
  readonly dynamoBillingMode: 'PAY_PER_REQUEST';
  /** Whether stateful resources carry deletion protection. */
  readonly deletionProtection: boolean;
  /** DAD-Main GitHub `owner/repo` slug the runner clones. */
  readonly githubRepo: string;
}

interface AtmOverrides {
  readonly evidenceRetentionDays: number;
  readonly logRetentionDays: number;
  readonly computeType: codebuild.ComputeType;
  readonly buildTimeout: Duration;
  readonly deletionProtection: boolean;
}

const OVERRIDES: Record<EnvName, AtmOverrides> = {
  staging: {
    evidenceRetentionDays: 90,
    logRetentionDays: 30,
    computeType: codebuild.ComputeType.MEDIUM,
    buildTimeout: Duration.hours(1),
    deletionProtection: false,
  },
  production: {
    evidenceRetentionDays: 365,
    logRetentionDays: 365,
    computeType: codebuild.ComputeType.LARGE,
    buildTimeout: Duration.hours(2),
    deletionProtection: true,
  },
};

/**
 * Resolve the atm config for an environment name. Delegates env validation and
 * the account/region map to the shared `@dad-infra/config`, then layers on the
 * atm-specific fields.
 */
export function getAtmConfig(env?: string): AtmEnvConfig {
  const shared = getSharedConfig(env);
  const overrides = OVERRIDES[shared.env];
  return {
    ...shared,
    prefix: RESOURCE_PREFIX,
    evidenceRetentionDays: overrides.evidenceRetentionDays,
    logRetentionDays: overrides.logRetentionDays,
    computeType: overrides.computeType,
    buildTimeout: overrides.buildTimeout,
    dynamoBillingMode: 'PAY_PER_REQUEST',
    deletionProtection: overrides.deletionProtection,
    githubRepo: DAD_MAIN_REPO,
  };
}
