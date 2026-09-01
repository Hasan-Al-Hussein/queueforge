import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface SecurityAdvisoryRecord {
  readonly id: string;
  readonly aliases: readonly string[];
  readonly url: string;
}

interface SecurityGateRecord {
  readonly status: 'open' | 'mitigated';
  readonly checkedAt: string;
  readonly publishedAt: string | null;
  readonly safeVersions: readonly string[];
  readonly advisories: readonly SecurityAdvisoryRecord[];
  readonly note: string;
}

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

const patchPublicationDate = '2026-08-25';
const requiredAdvisories = [
  {
    identities: ['GHSA-2xp9-vwfh-vxw4'],
    url: 'https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4',
  },
  {
    identities: ['CVE-2026-75604', 'GHSA-p293-qw3h-jr36'],
    url: 'https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36',
  },
] as const;

const root = resolve(import.meta.dirname, '..');
const gate = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'next-security-gate.json'), 'utf8'),
) as SecurityGateRecord;
const webManifest = JSON.parse(
  readFileSync(resolve(root, 'apps', 'web', 'package.json'), 'utf8'),
) as PackageManifest;
const rootManifest = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
) as PackageManifest;
const installedVersion = webManifest.dependencies?.next;
const eslintPluginVersion = rootManifest.devDependencies?.['@next/eslint-plugin-next'];

const failures: string[] = [];
if (gate.status !== 'mitigated') {
  failures.push(gate.note);
}
if (gate.publishedAt === null || gate.publishedAt < patchPublicationDate) {
  failures.push(`Record the vendor release publication date (${patchPublicationDate} or later).`);
}
if (gate.publishedAt !== null && gate.checkedAt < gate.publishedAt) {
  failures.push('The gate check date cannot precede the recorded publication date.');
}

for (const required of requiredAdvisories) {
  const matchingRecord = gate.advisories.find((advisory) => {
    const identities = new Set([advisory.id, ...advisory.aliases]);
    return required.identities.every((identity) => identities.has(identity));
  });

  if (matchingRecord === undefined) {
    failures.push(`Record advisory identities ${required.identities.join(' / ')}.`);
    continue;
  }
  if (matchingRecord.url !== required.url) {
    failures.push(`Record the official advisory URL for ${required.identities.join(' / ')}.`);
  }
}
if (installedVersion === undefined || !gate.safeVersions.includes(installedVersion)) {
  failures.push(
    `Next ${installedVersion ?? '<missing>'} is not listed as patched by the recorded advisory.`,
  );
}
if (eslintPluginVersion !== installedVersion) {
  failures.push(
    `@next/eslint-plugin-next ${eslintPluginVersion ?? '<missing>'} must match Next ${installedVersion ?? '<missing>'}.`,
  );
}

if (failures.length > 0) {
  console.error('NEXT-01 security gate is OPEN:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  const advisoryIdentities = requiredAdvisories
    .flatMap((advisory) => advisory.identities)
    .join(', ');
  console.log(`NEXT-01 passed for Next ${installedVersion} under ${advisoryIdentities}.`);
}
