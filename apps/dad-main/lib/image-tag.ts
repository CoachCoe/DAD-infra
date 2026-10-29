import { Construct } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { EnvConfig } from './config';

/**
 * Name of the SSM parameter holding the image tag the environment last deployed
 * successfully (a git SHA). It is created by hand at bootstrap (docs/bootstrap.md), not
 * by CDK: DAD-Main's deploy pipeline updates it after each successful rollout, and a
 * CloudFormation-managed parameter could be reset to its template value.
 */
export function imageTagParameterName(env: EnvConfig['env']): string {
  return `/dad/${env}/image-tag`;
}

/**
 * The tag to give every task definition's image.
 *
 * Resolved by CloudFormation from the SSM parameter at deploy time (it appears as a
 * stack parameter of type `AWS::SSM::Parameter::Value<String>`), so offline synth needs
 * no lookup. Task definitions therefore always reference the last good release instead
 * of a placeholder, and a `cdk deploy` that changes a task definition cannot point a
 * service back at an image that does not exist. The deploy fails with a clear error if
 * the parameter has not been created.
 */
export function imageTagFor(scope: Construct, config: EnvConfig): string {
  return ssm.StringParameter.valueForStringParameter(
    scope,
    imageTagParameterName(config.env),
  );
}
