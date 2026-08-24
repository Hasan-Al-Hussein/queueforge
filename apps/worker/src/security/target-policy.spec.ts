import type { HostResolver } from './target-policy.js';
import { resolveWebhookTarget } from './target-policy.js';

const publicResolver: HostResolver = async () => [{ address: '93.184.216.34', family: 4 }];

describe('outbound webhook target policy', () => {
  it('requires http or https, exact hosts, and no embedded credentials', async () => {
    const policy = {
      allowPrivateNetworks: false,
      allowedHosts: new Set(['hooks.example.test']),
    };
    const credentialedTarget = ['https://user', ':', 'pass@hooks.example.test/webhook'].join('');

    await expect(
      resolveWebhookTarget('file:///etc/passwd', policy, publicResolver),
    ).rejects.toMatchObject({ code: 'WEBHOOK_TARGET_SCHEME_BLOCKED' });
    await expect(
      resolveWebhookTarget(
        'https://hooks.example.test.attacker.invalid/webhook',
        policy,
        publicResolver,
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_TARGET_HOST_BLOCKED' });
    await expect(
      resolveWebhookTarget(credentialedTarget, policy, publicResolver),
    ).rejects.toMatchObject({ code: 'WEBHOOK_TARGET_CREDENTIALS_BLOCKED' });
  });

  it('rejects any private resolution when private networks are disabled', async () => {
    const resolver: HostResolver = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    await expect(
      resolveWebhookTarget(
        'https://hooks.example.test/webhook',
        {
          allowPrivateNetworks: false,
          allowedHosts: new Set(['hooks.example.test']),
        },
        resolver,
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_TARGET_NETWORK_BLOCKED' });
  });

  it('blocks IPv4-mapped loopback addresses when private networks are disabled', async () => {
    await expect(
      resolveWebhookTarget('http://[::ffff:127.0.0.1]/webhook', {
        allowPrivateNetworks: false,
        allowedHosts: new Set(['::ffff:7f00:1']),
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_TARGET_NETWORK_BLOCKED' });
  });

  it('pins an explicitly allowed local sink address in local mode', async () => {
    const resolved = await resolveWebhookTarget(
      'http://localhost:3300/webhooks?source=test',
      {
        allowPrivateNetworks: true,
        allowedHosts: new Set(['localhost']),
      },
      async () => [{ address: '127.0.0.1', family: 4 }],
    );

    expect(resolved.address).toBe('127.0.0.1');
    expect(resolved.hostHeader).toBe('localhost:3300');
    expect(resolved.url.pathname).toBe('/webhooks');
  });
});
