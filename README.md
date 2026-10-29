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
    atm/             # DAD-Quality runner: CodeBuild + S3 evidence + DynamoDB ledger + triggers
  docs/
    design/          # architecture and decisions
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
| `CoachCoe/DAD-infra` | `dad-main-infra.yml` (`atm-infra.yml` reads the same variable) | `dad-<env>-infra-deploy` | `INFRA_DEPLOY_ROLE_ARN` |
| `CoachCoe/DAD-Main` | `deploy.yml` | `dad-<env>-app-deploy` | `APP_DEPLOY_ROLE_ARN` |

Create the `staging` and `production` environments in **both** repos and set the
variable on each (the role ARN is a stack output of the account's `pipeline-iam`
stack). The credentialed jobs stay skipped until the variable is set.

**The environment is the access control.** Any job in the trusted repo that runs under
the environment can assume the role, so restrict deployments in each environment's
settings: `staging` to the `dev` branch; `production` to `main` and release tags, with
required reviewers. Without a deployment-branch rule, a workflow on any branch could
select the environment.

## Offline verification (no deploys)

The estate is parked until the team is ready to incur AWS cost. All verification
is offline — never run `cdk deploy`, `aws`, or any live AWS command.

```sh
# from the repo root
npm install
npm run build
npx jest

# per-app offline synth (dummy account/region)
cd apps/atm
CDK_DEFAULT_ACCOUNT=111111111111 CDK_DEFAULT_REGION=us-east-2 npx cdk synth -c env=staging
CDK_DEFAULT_ACCOUNT=111111111111 CDK_DEFAULT_REGION=us-east-2 npx cdk synth -c env=production
```
