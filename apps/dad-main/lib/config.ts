/**
 * Typed per-environment configuration for the DAD-Main AWS deployment.
 *
 * The account/region/env-selection CORE is single-sourced from the shared
 * `@dad-infra/config` package (one place for the DAD account ids, region, and
 * `-c env` resolution). This module layers the DAD-Main-specific fields
 * (hostnames, sizing, feature toggles, db name) on top, so it stays the single
 * module every stack, bin, and test imports from `./config`.
 *
 * Confirmed facts (from docs/aws-deployment.md and PLAN.md):
 *   - region is always us-east-2 (Ohio)
 *   - staging account 853377042897, production account 216833405626
 *   - hosts live under dynamicaid.org; sending subdomain is a dedicated mail.* host
 *   - db name defaults to `dad`
 */
import {
  EnvName,
  EnvConfig as SharedEnvConfig,
  getConfig as getSharedConfig,
} from '@dad-infra/config';

/** Re-export the env name type so dependents keep importing it from `./config`. */
export { EnvName };

/** Fargate task sizing (CPU units / memory MiB) for one service tier. */
export interface TaskSize {
  /** Fargate CPU units (e.g. 256 = 0.25 vCPU, 512 = 0.5 vCPU, 1024 = 1 vCPU). */
  readonly cpu: number;
  /** Fargate memory in MiB (must be a valid pairing with `cpu`). */
  readonly memoryMiB: number;
}

/** Desired running task counts for the long-running services. */
export interface DesiredCounts {
  readonly api: number;
  readonly web: number;
  readonly nginx: number;
  /** Applied to each of the six worker services. */
  readonly workers: number;
}

/** Per-tier Fargate task sizes. Workers share one tier. */
export interface TaskSizes {
  readonly api: TaskSize;
  readonly web: TaskSize;
  readonly nginx: TaskSize;
  readonly worker: TaskSize;
}

/**
 * Resolved, fully-typed configuration for a single environment.
 *
 * Extends the shared core (`env`, `account`, `region`) with the DAD-Main
 * application fields.
 */
export interface EnvConfig extends SharedEnvConfig {
  /** Public donor site hostname (e.g. app.staging.dynamicaid.org). */
  readonly publicHost: string;
  /** Staff site hostname (e.g. staff.staging.dynamicaid.org). */
  readonly staffHost: string;
  /** Public origin: https:// + publicHost, lowercase, no trailing slash. */
  readonly publicOrigin: string;
  /** Staff origin: https:// + staffHost, lowercase, no trailing slash. */
  readonly staffOrigin: string;
  /** PostgreSQL database name. Defaults to `dad`. */
  readonly dbName: string;
  /** Whether RDS runs Multi-AZ. */
  readonly multiAz: boolean;
  /** Whether RDS and other stateful resources have deletion protection. */
  readonly deletionProtection: boolean;
  /** CloudWatch log retention in days. */
  readonly logRetentionDays: number;
  /** Desired running counts for the long-running services. */
  readonly desiredCounts: DesiredCounts;
  /** Fargate task sizes per service tier. */
  readonly taskSizes: TaskSizes;
  /** Dedicated SES sending subdomain (e.g. mail.staging.dynamicaid.org). */
  readonly sendingSubdomain: string;
  /** Whether the nginx ingress SG is restricted to Cloudflare ranges. */
  readonly cloudflareIngressEnabled: boolean;
}

/** The DAD-Main-specific fields layered on top of the shared core, per env. */
type AppFields = Omit<EnvConfig, keyof SharedEnvConfig>;

/** Default PostgreSQL database name (confirmed from operations docs). */
const DEFAULT_DB_NAME = 'dad';

/**
 * Normalize a hostname into an https origin: lowercase, no trailing slash.
 */
function toOrigin(host: string): string {
  const h = host.trim().toLowerCase().replace(/\/+$/, '');
  return `https://${h}`;
}

/**
 * Production-typical task sizes. Staging runs the smaller tier to keep test
 * costs down; production bumps api/web/worker memory and CPU for headroom.
 *
 * These are sensible defaults chosen for the foundation and can be tuned per
 * service later without changing the shape of the config.
 */
const STAGING_TASK_SIZES: TaskSizes = {
  api: { cpu: 512, memoryMiB: 1024 },
  web: { cpu: 512, memoryMiB: 1024 },
  nginx: { cpu: 256, memoryMiB: 512 },
  worker: { cpu: 256, memoryMiB: 512 },
};

const PRODUCTION_TASK_SIZES: TaskSizes = {
  api: { cpu: 1024, memoryMiB: 2048 },
  web: { cpu: 1024, memoryMiB: 2048 },
  nginx: { cpu: 512, memoryMiB: 1024 },
  worker: { cpu: 512, memoryMiB: 1024 },
};

const STAGING: AppFields = {
  publicHost: 'app.staging.dynamicaid.org',
  staffHost: 'staff.staging.dynamicaid.org',
  publicOrigin: toOrigin('app.staging.dynamicaid.org'),
  staffOrigin: toOrigin('staff.staging.dynamicaid.org'),
  dbName: DEFAULT_DB_NAME,
  multiAz: false,
  deletionProtection: false,
  logRetentionDays: 30,
  desiredCounts: { api: 1, web: 1, nginx: 1, workers: 1 },
  taskSizes: STAGING_TASK_SIZES,
  sendingSubdomain: 'mail.staging.dynamicaid.org',
  cloudflareIngressEnabled: true,
};

const PRODUCTION: AppFields = {
  publicHost: 'app.dynamicaid.org',
  staffHost: 'staff.dynamicaid.org',
  publicOrigin: toOrigin('app.dynamicaid.org'),
  staffOrigin: toOrigin('staff.dynamicaid.org'),
  dbName: DEFAULT_DB_NAME,
  multiAz: true,
  deletionProtection: true,
  // Longer retention in production for audit/forensics.
  logRetentionDays: 365,
  desiredCounts: { api: 2, web: 2, nginx: 2, workers: 1 },
  taskSizes: PRODUCTION_TASK_SIZES,
  sendingSubdomain: 'mail.dynamicaid.org',
  cloudflareIngressEnabled: true,
};

const APP_FIELDS: Record<EnvName, AppFields> = {
  staging: STAGING,
  production: PRODUCTION,
};

/**
 * Resolve the config for an environment name.
 *
 * Account/region/env-validation come from the shared `@dad-infra/config`
 * `getConfig`; the DAD-Main app fields are merged on top. The resolved object
 * is field-for-field identical to the pre-extraction local config.
 *
 * @param env environment selector; defaults to `staging` when undefined/empty.
 * @throws if `env` is a non-empty value that is not `staging` or `production`.
 */
export function getConfig(env?: string): EnvConfig {
  const shared = getSharedConfig(env);
  return { ...shared, ...APP_FIELDS[shared.env] };
}
