import { describe, expect, it } from 'vitest';

import {
  MOBILE_RECOVERY_PREVIEW_SIZE,
  automaticTryLabel,
  failureExplanation,
  queueDisplayName,
  queueStatePresentation,
  recoveryPreviewToggleLabel,
  requestTypeDisplayName,
} from './processing-presentation';

describe('processing presentation', () => {
  it('names internal processing lanes after the work users recognize', () => {
    expect(queueDisplayName('queueforge.requests')).toBe('Requests');
    expect(queueDisplayName('queueforge.webhooks')).toBe('Result deliveries');
    expect(queueDisplayName('queueforge.custom_exports')).toBe('Custom exports');
  });

  it('explains known failures and preserves a safe fallback', () => {
    expect(failureExplanation('worker attempt interrupted; attempts exhausted')).toContain(
      'Processing stopped',
    );
    expect(failureExplanation('totally-new-error')).toContain('could not finish');
  });

  it('formats automatic attempt counts', () => {
    expect(automaticTryLabel(1)).toBe('1 automatic try');
    expect(automaticTryLabel(2)).toBe('2 automatic tries');
  });

  it('keeps the mobile recovery preview to five and names its disclosure clearly', () => {
    expect(MOBILE_RECOVERY_PREVIEW_SIZE).toBe(5);
    expect(recoveryPreviewToggleLabel(10, false)).toBe('Show 5 more on this page');
    expect(recoveryPreviewToggleLabel(10, true)).toBe('Show fewer requests');
    expect(recoveryPreviewToggleLabel(3, false)).toBe('Show 0 more on this page');
  });

  it('gives generated demo checks stable names people can recognize', () => {
    expect(requestTypeDisplayName('Exhausted workflow mt7zn31q-376afe34')).toBe(
      'Demo processing-failure check',
    );
    expect(requestTypeDisplayName('Expense review')).toBe('Expense review');
  });

  it('prioritizes unavailable processors and handoff failures without inventing state', () => {
    expect(
      queueStatePresentation({
        active: 0,
        delayed: 0,
        failed: 0,
        outboxDead: 2,
        paused: false,
        telemetryAvailable: false,
        waiting: 0,
        workerState: 'unavailable',
      }),
    ).toEqual({
      label: 'handoff needs attention',
      status: 'failed',
      workerLabel: 'not visible in this workspace',
    });
    expect(
      queueStatePresentation({
        active: 1,
        delayed: 0,
        failed: 0,
        outboxDead: 0,
        paused: false,
        telemetryAvailable: true,
        waiting: 0,
        workerState: 'running',
      }).label,
    ).toBe('working');
  });
});
