import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { RetryableDeliveryError, TerminalDeliveryError } from '../core/errors.js';

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export interface TargetPolicy {
  readonly allowPrivateNetworks: boolean;
  readonly allowedHosts: ReadonlySet<string>;
}

export interface ResolvedWebhookTarget {
  readonly address: string;
  readonly family: 4 | 6;
  readonly hostHeader: string;
  readonly originalHostname: string;
  readonly url: URL;
}

const nonPublicNetworks = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  nonPublicNetworks.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::', 96],
  ['::ffff:0:0', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  nonPublicNetworks.addSubnet(network, prefix, 'ipv6');
}

function normalizeHost(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return withoutBrackets.toLowerCase();
}

function isNonPublic(address: ResolvedAddress): boolean {
  return nonPublicNetworks.check(address.address, address.family === 4 ? 'ipv4' : 'ipv6');
}

const defaultResolver: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => {
    if (entry.family !== 4 && entry.family !== 6) {
      throw new Error('DNS resolver returned an unsupported address family');
    }
    return { address: entry.address, family: entry.family };
  });
};

export async function resolveWebhookTarget(
  value: string,
  policy: TargetPolicy,
  resolver: HostResolver = defaultResolver,
): Promise<ResolvedWebhookTarget> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TerminalDeliveryError('Webhook target is not a valid URL', 'WEBHOOK_TARGET_INVALID');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TerminalDeliveryError(
      'Webhook target scheme is not allowed',
      'WEBHOOK_TARGET_SCHEME_BLOCKED',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new TerminalDeliveryError(
      'Webhook target credentials are not allowed',
      'WEBHOOK_TARGET_CREDENTIALS_BLOCKED',
    );
  }
  if (url.hash !== '') {
    throw new TerminalDeliveryError(
      'Webhook target fragments are not allowed',
      'WEBHOOK_TARGET_FRAGMENT_BLOCKED',
    );
  }

  const hostname = normalizeHost(url.hostname);
  if (!policy.allowedHosts.has(hostname)) {
    throw new TerminalDeliveryError(
      'Webhook target host is not allowlisted',
      'WEBHOOK_TARGET_HOST_BLOCKED',
    );
  }

  let addresses: readonly ResolvedAddress[];
  const addressFamily = isIP(hostname);
  if (addressFamily === 4 || addressFamily === 6) {
    addresses = [{ address: hostname, family: addressFamily }];
  } else {
    try {
      addresses = await resolver(hostname);
    } catch {
      throw new RetryableDeliveryError('Webhook target DNS lookup failed', 'WEBHOOK_DNS_FAILED');
    }
  }
  if (addresses.length === 0) {
    throw new RetryableDeliveryError(
      'Webhook target resolved to no addresses',
      'WEBHOOK_DNS_EMPTY',
    );
  }
  if (addresses.some((entry) => isIP(entry.address) !== entry.family)) {
    throw new TerminalDeliveryError(
      'Webhook target returned an invalid address',
      'WEBHOOK_DNS_INVALID',
    );
  }
  if (!policy.allowPrivateNetworks && addresses.some(isNonPublic)) {
    throw new TerminalDeliveryError(
      'Webhook target resolved to a non-public address',
      'WEBHOOK_TARGET_NETWORK_BLOCKED',
    );
  }

  const [selected] = [...addresses].sort((left, right) => {
    const familyOrder = left.family - right.family;
    return familyOrder === 0 ? left.address.localeCompare(right.address) : familyOrder;
  });
  if (selected === undefined) {
    throw new RetryableDeliveryError(
      'Webhook target resolved to no addresses',
      'WEBHOOK_DNS_EMPTY',
    );
  }

  const explicitPort = url.port;
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  const hostForHeader = addressFamily === 6 ? `[${hostname}]` : hostname;
  return {
    address: selected.address,
    family: selected.family,
    hostHeader:
      explicitPort !== '' && explicitPort !== defaultPort
        ? `${hostForHeader}:${explicitPort}`
        : hostForHeader,
    originalHostname: hostname,
    url,
  };
}
