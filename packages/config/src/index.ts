/**
 * Shared, single-sourced DAD account/region configuration.
 *
 * This is the one place the DAD account ids, region, and `-c env` resolution
 * live. Both CDK apps (apps/atm, later apps/dad-main) import it and extend it
 * with their own app-specific fields.
 *
 * Confirmed facts (from DAD-Main/infra/lib/config.ts and the design doc):
 *   - region is always us-east-2 (Ohio)
 *   - staging (sandbox) account 853377042897, production account 216833405626
 *
 * App-specific DAD-Main fields (hosts, task sizes, db) are intentionally NOT
 * here — they belong to that app's own config layer.
 */

/** The two supported deployment environments. */
export type EnvName = 'staging' | 'production';

/** Resolved, fully-typed shared configuration for a single environment. */
export interface EnvConfig {
  /** Environment name. */
  readonly env: EnvName;
  /** 12-digit AWS account id this environment deploys into. */
  readonly account: string;
  /** AWS region. Always us-east-2 for DAD. */
  readonly region: string;
}

/** DAD deploys exclusively to Ohio. */
export const REGION = 'us-east-2';

/** sandbox account — the `staging` deploy target. */
export const STAGING_ACCOUNT = '853377042897';

/** production account — the `production` deploy target. */
export const PRODUCTION_ACCOUNT = '216833405626';

const STAGING: EnvConfig = {
  env: 'staging',
  account: STAGING_ACCOUNT,
  region: REGION,
};

const PRODUCTION: EnvConfig = {
  env: 'production',
  account: PRODUCTION_ACCOUNT,
  region: REGION,
};

const CONFIGS: Record<EnvName, EnvConfig> = {
  staging: STAGING,
  production: PRODUCTION,
};

/**
 * Resolve the shared config for an environment name.
 *
 * @param env environment selector; defaults to `staging` when undefined/empty.
 * @throws if `env` is a non-empty value that is not `staging` or `production`.
 */
export function getConfig(env?: string): EnvConfig {
  const name = (env ?? '').trim().toLowerCase();
  if (name === '' || name === 'staging') {
    return CONFIGS.staging;
  }
  if (name === 'production') {
    return CONFIGS.production;
  }
  throw new Error(
    `Unknown env '${env}'. Expected 'staging' or 'production' (default 'staging').`,
  );
}
