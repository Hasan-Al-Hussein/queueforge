import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useUnsavedChangesWarning } from './use-unsaved-changes-warning';

describe('useUnsavedChangesWarning', () => {
  it('cancels beforeunload only while unsaved changes exist', () => {
    const { rerender } = renderHook(
      ({ dirty }: { readonly dirty: boolean }) => useUnsavedChangesWarning(dirty),
      { initialProps: { dirty: true } },
    );
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    rerender({ dirty: false });
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);
  });
});
