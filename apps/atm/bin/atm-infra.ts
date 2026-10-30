#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { getAtmConfig } from '../lib/atm-config';
import { EvidenceStack } from '../lib/evidence-stack';
import { LedgerStack } from '../lib/ledger-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { RunnerStack } from '../lib/runner-stack';
import { TriggerStack } from '../lib/trigger-stack';

/**
 * DAD-Quality (atm) infrastructure CDK app entrypoint.
 *
 * Environment is selected with `-c env=staging|production` (default staging).
 * Account/region come from the resolved AtmEnvConfig, with CDK_DEFAULT_ACCOUNT /
 * CDK_DEFAULT_REGION as the offline-synth fallback so `cdk synth` works with
 * dummy credentials.
 *
 * Stack graph:
 *   {evidence, ledger, secrets} → runner → trigger
 */
const app = new cdk.App();

const envName = (app.node.tryGetContext('env') as string | undefined) ?? 'staging';
const config = getAtmConfig(envName);

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? config.account,
  region: process.env.CDK_DEFAULT_REGION ?? config.region,
};

cdk.Tags.of(app).add('Project', 'dad');
cdk.Tags.of(app).add('Environment', config.env);
cdk.Tags.of(app).add('Component', 'atm');

const stackId = (name: string): string => `atm-${name}-${config.env}`;

// Independent data stacks.
const evidence = new EvidenceStack(app, stackId('evidence'), { env, config });
const ledger = new LedgerStack(app, stackId('ledger'), { env, config });
const secrets = new SecretsStack(app, stackId('secrets'), { env, config });

// Runner joins the three data stacks with a scoped service role.
const runner = new RunnerStack(app, stackId('runner'), {
  env,
  config,
  evidenceBucket: evidence.bucket,
  findingsTable: ledger.table,
  secrets: [secrets.openai, secrets.tinker],
});

// Triggers: EventBridge Scheduler only (no CI-triggered role; see trigger-stack.ts).
new TriggerStack(app, stackId('trigger'), {
  env,
  config,
  project: runner.project,
});

app.synth();
