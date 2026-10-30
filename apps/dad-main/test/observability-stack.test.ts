import { Template, Match } from 'aws-cdk-lib/assertions';
import { buildGraph } from './helpers';

describe('ObservabilityStack', () => {
  it('creates one SNS topic', () => {
    const t = Template.fromStack(buildGraph('staging').observability);
    t.resourceCountIs('AWS::SNS::Topic', 1);
  });

  it('alarms only the running services while workers are off', () => {
    const t = Template.fromStack(buildGraph('staging').observability);
    // api, web, nginx + 2 database.
    t.resourceCountIs('AWS::CloudWatch::Alarm', 5);
  });

  it('adds an alarm per worker service once workers are on', () => {
    const t = Template.fromStack(
      buildGraph('staging', { workersEnabled: true }).observability,
    );
    t.resourceCountIs('AWS::CloudWatch::Alarm', 11);
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

  it('has no alarm on a metric nothing publishes (the monitor task emits no queue-age metric)', () => {
    const t = Template.fromStack(buildGraph('staging').observability);
    const alarms = Object.values(t.findResources('AWS::CloudWatch::Alarm'));
    for (const a of alarms) {
      expect(a.Properties.Namespace).not.toMatch(/Monitor/);
      expect(a.Properties.MetricName).not.toBe('QueueAgeSeconds');
    }
  });
});
