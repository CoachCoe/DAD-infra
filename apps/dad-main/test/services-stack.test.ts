import { Template, Match } from 'aws-cdk-lib/assertions';
import { buildGraph } from './helpers';

describe('ServicesStack', () => {
  it('creates exactly 9 ECS services', () => {
    const t = Template.fromStack(buildGraph('staging').services);
    t.resourceCountIs('AWS::ECS::Service', 9);
  });

  it('defines the six worker commands as `worker --kind <kind>`', () => {
    const t = Template.fromStack(buildGraph('staging').services);
    const expected = [
      'stripe',
      'projections',
      'login-email',
      'email-changes',
      'messages',
      'push',
    ];
    for (const kind of expected) {
      t.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Command: ['worker', '--kind', kind],
          }),
        ]),
      });
    }
  });

  it('exposes container ports 8002 (api), 3000 (web), 8443 (nginx)', () => {
    const t = Template.fromStack(buildGraph('staging').services);
    for (const port of [8002, 3000, 8443]) {
      t.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            PortMappings: Match.arrayWith([
              Match.objectLike({ ContainerPort: port }),
            ]),
          }),
        ]),
      });
    }
  });

  it('sets DONOR_API_BASE_URL=http://api:8002 on the web service', () => {
    const t = Template.fromStack(buildGraph('staging').services);
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Environment: Match.arrayWith([
            {
              Name: 'DONOR_API_BASE_URL',
              Value: 'http://api:8002',
            },
          ]),
        }),
      ]),
    });
  });

  // ECS ignores a Dockerfile HEALTHCHECK, and deploy.yml gates on the rollout reaching
  // COMPLETED, so each HTTP service must declare its own container health check.
  describe('rollout health gate', () => {
    /** The container health check of the task definition with this family. */
    const healthCheckOf = (family: string): unknown => {
      const t = Template.fromStack(buildGraph('staging').services);
      const defs = t.findResources('AWS::ECS::TaskDefinition', {
        Properties: { Family: family },
      });
      const ids = Object.keys(defs);
      expect(ids).toHaveLength(1);
      const containers = defs[ids[0]].Properties.ContainerDefinitions;
      expect(containers).toHaveLength(1);
      return containers[0].HealthCheck;
    };

    it('api probes /health/live on 8002 (liveness, not DB-backed readiness)', () => {
      const hc = healthCheckOf('dad-api') as { Command: string[] };
      expect(hc.Command).toEqual([
        'CMD',
        'wget',
        '-q',
        '-O',
        '/dev/null',
        'http://127.0.0.1:8002/health/live',
      ]);
      expect(hc.Command.join(' ')).not.toContain('/health/ready');
    });

    it('nginx probes /health on 8081', () => {
      const hc = healthCheckOf('dad-nginx') as { Command: string[] };
      expect(hc.Command).toEqual([
        'CMD',
        'wget',
        '-q',
        '-O',
        '/dev/null',
        'http://127.0.0.1:8081/health',
      ]);
    });

    it('web probes / on 3000 and treats status >= 500 or a connection error as unhealthy', () => {
      const hc = healthCheckOf('dad-web') as { Command: string[] };
      expect(hc.Command.slice(0, 3)).toEqual(['CMD', 'node', '-e']);
      expect(hc.Command[3]).toContain('http://127.0.0.1:3000/');
      expect(hc.Command[3]).toContain('r.statusCode<500');
    });

    it('gives the HTTP services a start period so a slow boot is not counted as failure', () => {
      for (const family of ['dad-api', 'dad-web', 'dad-nginx']) {
        const hc = healthCheckOf(family) as { StartPeriod: number; Retries: number };
        expect(hc.StartPeriod).toBeGreaterThan(0);
        expect(hc.Retries).toBeGreaterThanOrEqual(5);
      }
    });

    it('declares no health check on the six workers (no HTTP surface)', () => {
      for (const w of [
        'stripe-worker',
        'projection-worker',
        'login-email-worker',
        'email-change-worker',
        'message-worker',
        'push-worker',
      ]) {
        expect(healthCheckOf(`dad-${w}`)).toBeUndefined();
      }
    });

    it('enables the deployment circuit breaker with rollback on all 9 services', () => {
      const t = Template.fromStack(buildGraph('staging').services);
      const services = t.findResources('AWS::ECS::Service');
      expect(Object.keys(services)).toHaveLength(9);
      for (const svc of Object.values(services)) {
        expect(svc.Properties.DeploymentConfiguration.DeploymentCircuitBreaker).toEqual({
          Enable: true,
          Rollback: true,
        });
      }
    });
  });

  // config.workersEnabled is the ONE worker switch: it sets the desired count, and
  // DAD-Main's deploy.yml reads that from ECS instead of keeping its own flag.
  describe('worker switch', () => {
    const WORKERS = [
      'stripe-worker',
      'projection-worker',
      'login-email-worker',
      'email-change-worker',
      'message-worker',
      'push-worker',
    ];
    const counts = (t: Template) =>
      Object.fromEntries(
        Object.values(t.findResources('AWS::ECS::Service')).map((s) => [
          s.Properties.ServiceName,
          s.Properties.DesiredCount,
        ]),
      );

    it.each(['staging', 'production'] as const)('%s: workers are off by default', (env) => {
      const c = counts(Template.fromStack(buildGraph(env).services));
      for (const w of WORKERS) expect([w, c[w]]).toEqual([w, 0]);
      // The HTTP services are unaffected.
      for (const s of ['api', 'web', 'nginx']) expect(c[s]).toBeGreaterThan(0);
    });

    it('turning the switch on runs each worker at its configured count', () => {
      const g = buildGraph('production', { workersEnabled: true });
      const c = counts(Template.fromStack(g.services));
      for (const w of WORKERS) expect([w, c[w]]).toEqual([w, g.config.desiredCounts.workers]);
      expect(g.config.desiredCounts.workers).toBeGreaterThan(0);
    });

    it('always sets DONOR_GO_WORKERS_ENABLED=true, which the worker binary requires', () => {
      for (const enabled of [false, true]) {
        const t = Template.fromStack(buildGraph('staging', { workersEnabled: enabled }).services);
        const defs = Object.values(t.findResources('AWS::ECS::TaskDefinition'));
        for (const w of WORKERS) {
          const def = defs.find((d) => d.Properties.Family === `dad-${w}`);
          const env = def!.Properties.ContainerDefinitions[0].Environment as Array<{ Name: string; Value: string }>;
          expect(env).toContainEqual({ Name: 'DONOR_GO_WORKERS_ENABLED', Value: 'true' });
        }
      }
    });
  });

  it('api registers in Service Connect reachable as api:8002', () => {
    const t = Template.fromStack(buildGraph('staging').services);
    t.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'api',
      ServiceConnectConfiguration: Match.objectLike({
        Enabled: true,
        Namespace: 'dad.staging.local',
        Services: Match.arrayWith([
          Match.objectLike({
            PortName: 'api',
            ClientAliases: Match.arrayWith([
              Match.objectLike({ DnsName: 'api', Port: 8002 }),
            ]),
          }),
        ]),
      }),
    });
  });
});
