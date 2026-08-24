import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface SecurityGateRecord {
  readonly status: 'open' | 'mitigated';
  readonly checkedAt: string;
  readonly advisoryId: string | null;
  readonly advisoryUrl: string | null;
  readonly publishedAt: string | null;
  readonly safeVersions: readonly string[];
  readonly note: string;
}

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
}

const root = resolve(import.meta.dirname, '..');
const gate = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'next-security-gate.json'), 'utf8'),
) as SecurityGateRecord;
const webManifest = JSON.parse(
  readFileSync(resolve(root, 'apps', 'web', 'package.json'), 'utf8'),
) as PackageManifest;
const installedVersion = webManifest.dependencies?.next;

const failures: string[] = [];
if (gate.status !== 'mitigated') {
  failures.push(gate.note);
}
if (
  gate.advisoryId === null ||
  gate.advisoryId.length === 0 ||
  !/^(CVE-|GHSA-)/.test(gate.advisoryId)
) {
  failures.push('Record the vendor advisory CVE or GHSA identity after publication.');
}
if (gate.advisoryUrl === null || !gate.advisoryUrl.startsWith('https://')) {
  failures.push('Record the HTTPS vendor advisory URL after publication.');
}
if (gate.publishedAt === null || gate.publishedAt < '2026-08-26') {
  failures.push('Record the vendor release publication date (2026-08-26 or later).');
}
if (installedVersion === undefined || !gate.safeVersions.includes(installedVersion)) {
  failures.push(
    `Next ${installedVersion ?? '<missing>'} is not listed as patched by the recorded advisory.`,
  );
}

if (failures.length > 0) {
  console.error('NEXT-01 security gate is OPEN:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`NEXT-01 passed for Next ${installedVersion} under ${gate.advisoryId}.`);
}
