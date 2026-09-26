import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const output = '../output/qa-stills';
mkdirSync(output, { recursive: true });

const stills = [
  { name: '00-problem-caption', frame: 90 },
  { name: '01-solution', frame: 810 },
  { name: '02-roles-login', frame: 1200 },
  { name: '02-roles-responsibilities-caption', frame: 1320 },
  { name: '03-tour-home', frame: 2100 },
  { name: '03-tour-request-types', frame: 2370 },
  { name: '03-tour-delivery-connections', frame: 2600 },
  { name: '03-tour-people-access', frame: 2770 },
  { name: '03-tour-processing-health', frame: 2960 },
  { name: '03-tour-activity-log', frame: 3170 },
  { name: '03-tour-notifications', frame: 3410 },
  { name: '03-tour-recap', frame: 3610 },
  { name: '04-submit-start', frame: 3750 },
  { name: '04-submit-details', frame: 3990 },
  { name: '04-submit-review', frame: 4290 },
  { name: '04-submit-result', frame: 4590 },
  { name: '05-approve-search', frame: 4800 },
  { name: '05-approve-review', frame: 4960 },
  { name: '05-approve-decision', frame: 5180 },
  { name: '06-process-failed-attempt', frame: 5550 },
  { name: '06-process-retry-complete', frame: 5820 },
  { name: '06-delivery-search', frame: 6060 },
  { name: '06-delivery-receipt', frame: 6270 },
  { name: '07-result-notification', frame: 6420 },
  { name: '07-result-1242-bridge', frame: 6760 },
  { name: '07-result-audit-search', frame: 6800 },
  { name: '07-result-audit-detail', frame: 7080 },
  { name: '08-pipeline-caption', frame: 7410 },
  { name: '09-close-caption', frame: 7940 },
  { name: '09-close-breathing-room', frame: 8270 },
] as const;

for (const still of stills) {
  execFileSync(
    'pnpm',
    [
      'exec',
      'remotion',
      'still',
      'src/index.ts',
      'QueueForgeProductDemo',
      `${output}/${still.name}.png`,
      '--frame',
      String(still.frame),
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
}
