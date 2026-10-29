# DAD-infra

A single home for the DAD AWS CDK estate. An npm-workspaces monorepo with one
shared config/pipeline core and one CDK app per tenant.

```
DAD-infra/
  packages/
    config/          # shared account map, region, EnvName, getConfig()
    pipeline-iam/    # shared GitHub OIDC provider + scoped deploy-role helper
  apps/
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
