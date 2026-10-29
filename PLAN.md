# Implementation Plan — DAD-infra (shared CDK estate)

Build the shared AWS CDK (TypeScript) monorepo described in
`docs/design/aws-infra-design.md`. Target region **us-east-2 (Ohio)**; accounts
sandbox/staging `853377042897`, production `216833405626`; env selected by
`-c env=staging|production`. This plan builds IaC + one atm-repo wrapper. **Do not
run `cdk deploy`, `aws`, or any live command.** All verification is offline:
`npm install`, `npm run build` (tsc), `npx jest`, and `cdk synth -c env=staging`
and `-c env=production` with dummy `CDK_DEFAULT_ACCOUNT`/`CDK_DEFAULT_REGION`. No
real AWS calls. The estate stays parked until the team is ready to incur cost.

Two repos are touched. Use absolute paths; relative paths would land in the wrong
workspace.

- **DAD-infra** (new): `/Users/shawncoe/Documents/dev/DAD/DAD-infra`
- **DAD-Quality** (`atm`): `/Users/shawncoe/Documents/dev/DAD/atm`
- **DAD-Main** (extraction, phase 4): `/Users/shawncoe/Documents/dev/DAD/DAD-Main`

Phase 4 (DAD-Main extraction) should run in a **git worktree** of DAD-Main so the
parent checkout is untouched until the move is verified.

## Conventions (inherited verbatim from DAD-Main/infra)

Confirmed from the actual DAD-Main files during exploration:

- **Toolchain (pin exactly):** `aws-cdk-lib` 2.275.0, `constructs` 10.8.1, dev
  `aws-cdk` 2.1146.1, `typescript` 5.9.3, `jest`/`ts-jest` 29.x, `ts-node` 10.9.2,
  `@types/node` 22.x, `@types/jest` 29.5.14.
- **tsconfig:** `target`/`lib` ES2022, `module` commonjs, `strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
  `resolveJsonModule`, `outDir dist`.
- **jest:** `ts-jest` preset, node env, `roots: ['<rootDir>/test']`,
  `testMatch: ['**/test/**/*.test.ts']`.
- **cdk.json app:** `npx ts-node --prefer-ts-exts bin/<app>.ts`, plus the DAD
  context feature flags (copy from DAD-Main `infra/cdk.json`).
- **Env resolution:** `account: process.env.CDK_DEFAULT_ACCOUNT ?? config.account`,
  same for region — the offline-synth fallback.
- **Tags:** `Project=dad`, `Environment=<env>`; atm app adds `Component=atm`.
- **Tests:** `aws-cdk-lib/assertions` `Template`, asserting the resources that
  matter (not snapshots).
- **Actions pinned by full commit SHA** with `# vX.Y.Z` comments. Reuse DAD-Main's
  known-good pins: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0,
  `aws-actions/configure-aws-credentials` v6.3.0.
- **Git ignore:** `node_modules/`, `dist/`, `*.js` (except `jest.config.js`),
  `*.d.ts`, `cdk.out/`, `cdk.context.json`, `.agents/`, `.DS_Store`.

---

## Phase 0 — repo scaffold (DAD-infra)

- [ ] **0.1 Monorepo skeleton + shared toolchain.**
      Create the workspace root: root `package.json` (npm workspaces over
      `packages/*` and `apps/*`), root `tsconfig.base.json` with the shared
      compiler options above, `.gitignore`, `jest.config.js` conventions reused per
      package/app, and `README.md` pointing at `docs/design/aws-infra-design.md`.
      Initialize git and wire the remote `https://github.com/CoachCoe/DAD-infra`.
      Files: `DAD-infra/package.json`, `DAD-infra/tsconfig.base.json`,
      `DAD-infra/.gitignore`, `DAD-infra/README.md`.
      Verify: `cd DAD-infra && npm install` succeeds; `git remote -v` shows origin.

- [ ] **0.2 `packages/config` — shared account/env config.**
      Port DAD-Main's `lib/config.ts` as the single source of truth for the account
      map (sandbox `853377042897`, production `216833405626`), `region us-east-2`,
      `EnvName`, and `getConfig(env)` with the default-to-staging + offline fallback.
      Keep DAD-Main's app-specific fields (hosts, task sizes, db) in that app's own
      config layer later; `packages/config` exports only the **shared** core
      (`EnvName`, `account`, `region`, `getConfig`) so both apps extend it.
      Files: `DAD-infra/packages/config/{package.json,tsconfig.json,src/index.ts}`,
      `DAD-infra/packages/config/test/config.test.ts`.
      Verify: `npm run build -w packages/config`; `npx jest` asserts both envs
      resolve the exact account ids and `us-east-2`, and unknown env throws.

- [ ] **0.3 `packages/pipeline-iam` — shared GitHub OIDC provider construct.**
      Extract the account-level **OIDC provider singleton** from DAD-Main's
      `pipeline-iam-stack.ts` into a reusable construct (one provider per account),
      plus a helper that mints a scoped deploy role from an
      `OpenIdConnectPrincipal` given repo + subject conditions. Apps (dad-main, atm)
      consume the provider and add their own roles/policies. Default repo slug is a
      context input, not hardcoded.
      Files: `DAD-infra/packages/pipeline-iam/{package.json,tsconfig.json,src/index.ts}`,
      `DAD-infra/packages/pipeline-iam/test/pipeline-iam.test.ts`.
      Verify: `npm run build -w packages/pipeline-iam`; `npx jest` asserts the
      provider URL (`token.actions.githubusercontent.com`), `aud sts.amazonaws.com`,
      and the subject-condition helper output.

---

## Phase 1 — DAD-Quality stack (`apps/atm`)

Primary deliverable: the ATM-on-AWS runner (Path A) with durable evidence (Path C).
Compute is **CodeBuild** (privileged Docker), not Fargate — see design §6.1.

- [ ] **1.1 App scaffold + atm env config.**
      Create `apps/atm` as a CDK app (`cdk.json` → `bin/atm-infra.ts`, DAD context
      flags), importing `packages/config` and extending it with atm-specific fields:
      resource-name prefix (`atm`), evidence-retention days per env, CodeBuild
      compute size + timeout, DynamoDB billing mode (on-demand), and the DAD-Main
      GitHub repo slug + branch→env map for the OIDC trust subject.
      Files: `apps/atm/{package.json,tsconfig.json,cdk.json,bin/atm-infra.ts,lib/atm-config.ts}`,
      `apps/atm/test/atm-config.test.ts`.
      Verify: `npm run build -w apps/atm`; `npx jest`; `CDK_DEFAULT_ACCOUNT=111111111111
      CDK_DEFAULT_REGION=us-east-2 npx cdk synth -c env=staging` (empty app) succeeds.

- [ ] **1.2 EvidenceStack — S3 evidence bucket.**
      Private bucket `atm-evidence-<env>-<account>`: Block Public Access (all four),
      SSE (S3-managed; KMS optional via config), versioning on, a lifecycle rule
      expiring objects after the configured retention (propose: staging 90d,
      production 365d — confirm), and `enforceSSL`. Output the bucket name/ARN.
      Files: `apps/atm/lib/evidence-stack.ts`, `apps/atm/test/evidence-stack.test.ts`.
      Verify: `npx cdk synth` both envs; test asserts BlockPublicAccess all-true,
      encryption present, versioning enabled, the lifecycle expiry = config value,
      and `enforceSSL` deny-policy present.

- [ ] **1.3 LedgerStack — DynamoDB finding ledger.**
      Table `atm-findings-<env>`: PK `source` (`source#<repo>`), SK `finding`
      (`finding#<normalized-signature>`), on-demand billing, PITR on,
      SSE on, `deletionProtection` from env config. GSI `by-status` (PK `source`,
      SK `status`) for the "unresolved blocking findings for this source" query.
      Output table name/ARN.
      Files: `apps/atm/lib/ledger-stack.ts`, `apps/atm/test/ledger-stack.test.ts`.
      Verify: `npx cdk synth` both envs; test asserts key schema, the `by-status`
      GSI, PAY_PER_REQUEST, PITR enabled, and deletionProtection toggles with env.

- [ ] **1.4 SecretsStack — provider API keys.**
      Secrets Manager secrets `atm/<env>/openai` and `atm/<env>/tinker` (empty
      placeholders; values filled out of band). No rotation. Output ARNs.
      Files: `apps/atm/lib/secrets-stack.ts`, `apps/atm/test/secrets-stack.test.ts`.
      Verify: `npx cdk synth` both envs; test asserts the two secrets exist with the
      expected names and no rotation schedule.

- [ ] **1.5 RunnerStack — CodeBuild project + scoped service role.**
      CodeBuild project `atm-runner-<env>`, `privileged: true`, Docker-capable
      standard image, compute size + build timeout from config. Source = DAD-Main
      GitHub repo (clone at `--source-version <sha>`; GitHub-read mechanism per
      design §10.6). Buildspec reference (the file itself ships in the atm repo,
      item 2.1): resolve revision → `npm run atm -- run` → post-run sync → exit with
      ATM's code. CloudWatch log group with env retention.
      Service role (least privilege): read `atm/<env>/*` secrets, read/write only the
      `atm-evidence-<env>` bucket prefix, `dynamodb` read + conditional-write on the
      `atm-findings-<env>` table + its GSI, and its own log group. Nothing with `*`
      on data stores.
      Files: `apps/atm/lib/runner-stack.ts`, `apps/atm/test/runner-stack.test.ts`.
      Verify: `npx cdk synth` both envs; test asserts `privileged=true`, the
      project name, log retention = config, and the role policy is scoped to the
      specific bucket/table/secret ARNs (no `Resource: "*"` on s3/dynamodb/secrets).

- [ ] **1.6 TriggerStack — EventBridge Scheduler + OIDC StartBuild role.**
      EventBridge Scheduler rule for nightly/periodic runs invoking
      `codebuild:StartBuild` on the project (role scoped to StartBuild on that
      project only). A GitHub OIDC deploy role (via `packages/pipeline-iam`) that
      DAD-Main CI assumes, permitted **only** `codebuild:StartBuild` on
      `atm-runner-<env>`, trust subject scoped to the DAD-Main repo + branch per
      env. Output the role ARN and project name for DAD-Main CI to consume.
      Files: `apps/atm/lib/trigger-stack.ts`, `apps/atm/test/trigger-stack.test.ts`,
      `apps/atm/bin/atm-infra.ts` (wire all stacks).
      Verify: `npx cdk synth` both envs; test asserts the scheduler target is the
      project, the StartBuild role action is exactly `codebuild:StartBuild` on the
      project ARN, and the OIDC role trust subject matches the DAD-Main repo/branch.

---

## Phase 2 — DAD-Quality post-run wrapper (atm repo)

Lives in `/Users/shawncoe/Documents/dev/DAD/atm`. This is a code change to the atm
repo, not IaC. Keeps ATM's core storage untouched (design §6.4).

- [ ] **2.1 CodeBuild buildspec.**
      `buildspec.atm.yml` at the atm repo root: install phase (Node 22, Playwright
      Chromium, Docker login as needed), build phase runs
      `npm run atm -- run --repo <checkout> --revision $SOURCE_SHA`, captures the
      exit code, runs the sync script (2.2), then `exit $ATM_EXIT` so CodeBuild and
      the calling CI gate on ATM's contract (0/1/2/3/130).
      Files: `atm/buildspec.atm.yml`.
      Verify: YAML parses (`node -e` / yaml lint); documented, not executed.

- [ ] **2.2 Post-run sync script.**
      `scripts/aws-sync-run.js` (Node, no new runtime deps beyond AWS SDK v3 added
      to the atm repo): after a run, upload the run directory
      (`run.json`, `report.html`, evidence) to `s3://atm-evidence-<env>/<repo>/<sha>/<run-id>/`,
      then reconcile that run's findings into DynamoDB with **conditional writes**
      (create-if-absent, reopen-on-recurrence, preserve assessment history) so
      concurrent runs are safe. Read bucket/table/env from environment variables set
      by the RunnerStack, never hardcoded. Dry-run mode for local testing without
      AWS.
      Files: `atm/scripts/aws-sync-run.js`, `atm/package.json` (add `aws-sdk`
      v3 client deps + an `aws:sync` script), `atm/docs/aws-runner.md` (operator
      doc: env vars, what gets uploaded, the ledger reconcile semantics).
      Verify: `node --check scripts/aws-sync-run.js`; `npm run check`,
      `npm run typecheck`, `npm run lint` (atm's existing gates) pass; a dry-run
      unit test asserts the S3 key layout and the conditional-write expressions
      without touching AWS.

---

## Phase 3 — DAD-infra CI pipeline

- [ ] **3.1 `apps/atm` infra pipeline.**
      `.github/workflows/atm-infra.yml`, path-filtered to `apps/atm/**` and
      `packages/**`: PR → offline `cdk synth` of both envs (no creds); merge to
      `dev` → `cdk deploy -c env=staging` (gated on the deploy-role var being set,
      skip/no-op until bootstrapped, matching DAD-Main's pattern); release/`main` →
      `cdk deploy -c env=production` gated by a `production` GitHub Environment.
      OIDC via the pipeline-iam role. Actions SHA-pinned.
      Files: `DAD-infra/.github/workflows/atm-infra.yml`.
      Verify: YAML parses; the synth-both-envs job is unconditional; credentialed
      jobs are gated on the role-ARN var.

---

## Phase 4 — DAD-Main extraction (DAD-Main + DAD-infra)

Run in a DAD-Main worktree. DAD-Main's infra is finished and parked, so this is a
pure relocation + de-dup verified entirely offline.

- [ ] **4.1 Move DAD-Main infra into `apps/dad-main`.**
      Copy `DAD-Main/infra/{bin,lib,test,cdk.json,jest.config.js,tsconfig.json}`
      into `DAD-infra/apps/dad-main/`, adapt `package.json` to the workspace, and
      repoint imports.
      Verify: `npm run build -w apps/dad-main`; `npx jest`; `cdk synth` both envs
      produce output equivalent to DAD-Main's original (compare templates).

- [ ] **4.2 De-duplicate config + OIDC into shared packages.**
      Replace `apps/dad-main/lib/config.ts`'s account/region/`getConfig` core with
      imports from `packages/config` (keep the DAD-Main-specific fields — hosts,
      task sizes, db — as an app extension). Replace the OIDC **provider** creation
      in `apps/dad-main`'s pipeline-iam with the shared `packages/pipeline-iam`
      construct; keep DAD-Main's `infra-deploy`/`app-deploy` roles app-scoped.
      Verify: `npm run build`; `npx jest`; `cdk synth` both envs still succeed and
      the account/region/role-trust assertions pass unchanged.

- [ ] **4.3 Repoint DAD-Main pipelines.**
      Move/adapt `DAD-Main/.github/workflows/{infra.yml,deploy.yml}` to target the
      new location (either into `DAD-infra/.github/workflows/dad-main-*.yml` with
      path filters `apps/dad-main/**`, or leave `deploy.yml` in DAD-Main if the app
      rollout stays repo-local — decide during implementation). Do **not** modify
      DAD-Main's `ci.yml`.
      Verify: YAML parses; `ci.yml` byte-unchanged; path filters correct.

- [ ] **4.4 Remove the old DAD-Main/infra (after verification).**
      Only once 4.1–4.3 verify offline: delete `DAD-Main/infra/` in the worktree and
      leave a short `DAD-Main/infra/README.md` stub pointing to DAD-infra. Rebase the
      worktree branch and fast-forward DAD-Main from the user's checkout.
      Verify: DAD-Main repo builds/lints without the infra dir; DAD-infra's full
      offline gate passes for both apps.

---

## Final verification gate (offline only)

From `DAD-infra/`: `npm install`, `npm run build` (all workspaces), `npx jest` (all
workspaces), and for each app:
`CDK_DEFAULT_ACCOUNT=111111111111 CDK_DEFAULT_REGION=us-east-2 npx cdk synth -c env=staging`
and `-c env=production`. From `atm/`: `npm run check`, `npm run typecheck`,
`npm run lint`, and the sync-script dry-run test. **No `cdk deploy`, no `aws`
calls, no real credentials.** Confirm DAD-Main's `ci.yml` is unchanged and all new
workflow YAML parses.

## Sequencing notes

- Phases 0 → 1 → 2 → 3 deliver the primary goal (DAD-Quality on AWS with durable
  evidence + the trigger path). Phase 4 (DAD-Main extraction) can follow and is
  isolated in a worktree.
- Phase 1 stacks are mostly independent (Evidence, Ledger, Secrets) and converge at
  RunnerStack (1.5) and TriggerStack (1.6); they can be built in parallel up to
  that join.
- Open design items to settle while implementing: evidence retention window
  (1.2), GitHub-read mechanism for the clone (1.5), and the DAAD-website spelling
  (doc only).
