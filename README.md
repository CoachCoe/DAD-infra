# DAD-infra

A single home for the DAD AWS CDK estate. An npm-workspaces monorepo with one
shared config/pipeline core and one CDK app per tenant.

```
DAD-infra/
  packages/
    config/          # shared account map, region, EnvName, getConfig()
    pipeline-iam/    # shared GitHub OIDC provider + scoped deploy-role helper
  apps/
    dad-main/        # DAD-Main estate: VPC, RDS + Proxy, ECS Fargate, SES, NLB, pipeline IAM
      lambda/        #   SES SMTP credential rotation function (Python)
    atm/             # DAD-Quality runner on AWS: built and tested, NOT deployed (see design §6.5)
  docs/
    design/          # architecture and decisions
    bootstrap.md     # first deploy of an environment
    branch-protection.md
```

## Design

The authoritative architecture, account/region model, and decisions live in
[docs/design/aws-infra-design.md](docs/design/aws-infra-design.md).

## Environments

- `staging` → sandbox account `853377042897`
- `production` → account `216833405626`
- Region: `us-east-2` (Ohio)

Environment is selected with `-c env=staging|production` (default `staging`).

## GitHub Environments and deploy roles

Deploys authenticate with GitHub OIDC (no static keys). Every deploy job runs under a
GitHub Environment named `staging` or `production`, so GitHub issues the token with
`sub = repo:<owner>/<repo>:environment:<name>`, and each role trusts exactly that for
exactly one repo:

| Repo | Workflow | Role (created by `apps/dad-main` pipeline-iam) | Environment variable |
|---|---|---|---|
| `CoachCoe/DAD-infra` | `dad-main-infra.yml` | `dad-<env>-infra-deploy` | `INFRA_DEPLOY_ROLE_ARN` |
| `CoachCoe/DAD-Main` | `deploy.yml` | `dad-<env>-app-deploy` | `APP_DEPLOY_ROLE_ARN` |

Create the `staging` and `production` environments in **both** repos and set the
variable on each (the role ARN is a stack output of the account's `pipeline-iam`
stack). The credentialed jobs stay skipped until the variable is set. `atm-infra.yml`
has no deploy jobs (the runner is held).

**The environment is the access control.** Any job in the trusted repo that runs under
the environment can assume the role, so restrict deployments in each environment's
settings: `staging` to the `dev` branch; `production` to `main`, with required reviewers.
Production is deployed only by a push to `main`: there is no release- or tag-triggered
path. Without a deployment-branch rule, a workflow on any branch could
select the environment.

## Offline verification (no deploys)

Nothing is deployed yet; the first deploy follows [docs/bootstrap.md](docs/bootstrap.md).
The checks below are offline and need no AWS credentials. CI's required `synth` check
runs the same tests and synth on every PR.

```sh
# from the repo root
npm install
npm run build
npx jest   # all workspaces; also runs the rotation function's Python tests (needs python3)

# per-app offline synth (dummy account/region), for apps/dad-main and apps/atm
cd apps/dad-main
CDK_DEFAULT_ACCOUNT=111111111111 CDK_DEFAULT_REGION=us-east-2 npx cdk synth -c env=staging
CDK_DEFAULT_ACCOUNT=111111111111 CDK_DEFAULT_REGION=us-east-2 npx cdk synth -c env=production
```
