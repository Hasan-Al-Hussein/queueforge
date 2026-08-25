import { describe, expect, it } from 'vitest';

import {
  automaticTryLabel,
  failureExplanation,
  queueDisplayName,
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

  it('gives generated demo checks stable names people can recognize', () => {
    expect(requestTypeDisplayName('Exhausted workflow mt7zn31q-376afe34')).toBe(
      'Demo processing-failure check',
    );
    expect(requestTypeDisplayName('Expense review')).toBe('Expense review');
  });
});
