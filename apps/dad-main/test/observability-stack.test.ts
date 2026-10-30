import { Template, Match } from 'aws-cdk-lib/assertions';
import { buildGraph } from './helpers';

describe('ObservabilityStack', () => {
  it('creates one SNS topic', () => {
    const t = Template.fromStack(buildGraph('staging').observability);
    t.resourceCountIs('AWS::SNS::Topic', 1);
  });

  it('alarms only the running services while workers are off', () => {
    const t = Template.fromStack(buildGraph('staging').observability);
    // api, web, nginx + 2 database + 1 monitor queue-age placeholder.
    t.resourceCountIs('AWS::CloudWatch::Alarm', 6);
  });

  it('adds an alarm per worker service once workers are on', () => {
    const t = Template.fromStack(
      buildGraph('staging', { workersEnabled: true }).observability,
    );
    t.resourceCountIs('AWS::CloudWatch::Alarm', 12);
  });

  it('alarms on database CPU and free storage', () => {
    const t = Template.fromStack(buildGraph('staging').observability);
    for (const metricName of ['CPUUtilization', 'FreeStorageSpace']) {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: metricName,
        Namespace: 'AWS/RDS',
      });
    }
  });

  it('service-health alarms fire when running < desired', () => {
    const t = Template.fromStack(buildGraph('staging').observability);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      ComparisonOperator: 'LessThanThreshold',
      MetricName: 'RunningTaskCount',
      AlarmActions: Match.anyValue(),
    });
  });
});
