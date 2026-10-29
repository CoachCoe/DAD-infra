/**
 * Shared GitHub Actions OIDC pipeline primitives for the DAD estate.
 *
 * A GitHub Actions OIDC provider is an account-level singleton. This package
 * owns the provider construct once so that if two apps (dad-main, atm) were to
 * create their own in separate stacks they would not collide. Each app
 * contributes its own scoped deploy roles via {@link scopedDeployRole}.
 *
 * Extracted from DAD-Main/infra/lib/pipeline-iam-stack.ts.
 */
import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

/** The GitHub Actions OIDC issuer URL. */
export const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';

/** The OIDC issuer host (without scheme), used for condition keys. */
export const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';

/** The audience GitHub's OIDC tokens are minted for when targeting AWS STS. */
export const OIDC_AUDIENCE = 'sts.amazonaws.com';

/** Props for {@link GitHubOidcProvider}. */
export interface GitHubOidcProviderProps {
  /**
   * Optional override of the issuer URL. Defaults to the GitHub Actions OIDC
   * endpoint. Exposed only for tests; production always uses the default.
   */
  readonly url?: string;
}

/**
 * The account-level GitHub Actions OIDC provider.
 *
 * One per account. Apps reference `.provider` when minting deploy roles.
 */
export class GitHubOidcProvider extends Construct {
  public readonly provider: iam.OpenIdConnectProvider;

  constructor(scope: Construct, id: string, props: GitHubOidcProviderProps = {}) {
    super(scope, id);

    this.provider = new iam.OpenIdConnectProvider(this, 'Provider', {
      url: props.url ?? GITHUB_OIDC_URL,
      clientIds: [OIDC_AUDIENCE],
    });
  }
}

/**
 * Build the GitHub OIDC `sub` claim subjects that a role should trust for a
 * given environment and repo.
 *
 *   - staging    → the `dev` branch
 *   - production → the `production` GitHub Environment + any release tag
 *
 * The repo slug (`owner/repo`) is a caller input, never hardcoded.
 */
export function githubSubjectConditions(
  repo: string,
  env: 'staging' | 'production',
): string[] {
  return env === 'production'
    ? [`repo:${repo}:environment:production`, `repo:${repo}:ref:refs/tags/*`]
    : [`repo:${repo}:ref:refs/heads/dev`];
}

/**
 * The `sub` claim GitHub issues to a job that runs under a GitHub Environment:
 * `repo:<owner>/<repo>:environment:<name>`.
 *
 * When a job sets `environment:`, GitHub uses this form and NOT the branch or tag
 * form, so a role that must be assumed by such a job has to trust this exact value.
 * The GitHub Environment names are `staging` and `production`, matching the CDK
 * env names.
 */
export function githubEnvironmentSubject(
  repo: string,
  env: 'staging' | 'production',
): string {
  return `repo:${repo}:environment:${env}`;
}

/**
 * Build an {@link iam.OpenIdConnectPrincipal} that trusts exactly one repo's GitHub
 * Environment: `aud` pinned to STS and `sub` an exact match (no wildcards) on
 * {@link githubEnvironmentSubject}.
 *
 * The trust is only as narrow as the GitHub Environment itself. Any job in `repo`
 * that runs under this environment can assume the role, so restrict which branches
 * and tags may deploy to the environment in the repository settings.
 */
export function githubEnvironmentPrincipal(
  provider: iam.IOpenIdConnectProvider,
  repo: string,
  env: 'staging' | 'production',
): iam.OpenIdConnectPrincipal {
  return new iam.OpenIdConnectPrincipal(provider, {
    StringEquals: {
      [`${GITHUB_OIDC_HOST}:aud`]: OIDC_AUDIENCE,
      [`${GITHUB_OIDC_HOST}:sub`]: githubEnvironmentSubject(repo, env),
    },
  });
}

/**
 * Build an {@link iam.OpenIdConnectPrincipal} for the given provider, repo, and
 * env, with the `aud` pinned to STS and the `sub` pinned to the env's subjects.
 *
 * This is the branch/tag form (staging ← `dev`, production ← environment + tags).
 * It only matches jobs that do NOT run under a GitHub Environment for staging; for
 * jobs that do, use {@link githubEnvironmentPrincipal}.
 */
export function githubOidcPrincipal(
  provider: iam.IOpenIdConnectProvider,
  repo: string,
  env: 'staging' | 'production',
): iam.OpenIdConnectPrincipal {
  return new iam.OpenIdConnectPrincipal(provider, {
    StringEquals: {
      [`${GITHUB_OIDC_HOST}:aud`]: OIDC_AUDIENCE,
    },
    StringLike: {
      [`${GITHUB_OIDC_HOST}:sub`]: githubSubjectConditions(repo, env),
    },
  });
}

/** Options for {@link scopedDeployRole}. */
export interface ScopedDeployRoleProps {
  /** The account-level OIDC provider. */
  readonly provider: iam.IOpenIdConnectProvider;
  /** GitHub `owner/repo` slug the role trusts. */
  readonly repo: string;
  /** Environment governing the trusted subject claims. */
  readonly env: 'staging' | 'production';
  /** Explicit IAM role name. */
  readonly roleName: string;
  /** Human-readable role description. */
  readonly description?: string;
  /** Max assumed-session duration. Defaults to 1 hour. */
  readonly maxSessionDuration?: Duration;
}

/**
 * Mint a least-privilege GitHub-OIDC-assumable deploy role.
 *
 * The role trusts only the given repo and the env-appropriate `sub` claims.
 * Callers attach their own narrowly-scoped policy statements to the returned
 * role (e.g. ATM's "StartBuild on exactly this project").
 */
export function scopedDeployRole(
  scope: Construct,
  id: string,
  props: ScopedDeployRoleProps,
): iam.Role {
  return new iam.Role(scope, id, {
    roleName: props.roleName,
    assumedBy: githubOidcPrincipal(props.provider, props.repo, props.env),
    description: props.description,
    maxSessionDuration: props.maxSessionDuration ?? Duration.hours(1),
  });
}
