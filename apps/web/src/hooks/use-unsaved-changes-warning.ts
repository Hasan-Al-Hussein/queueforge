'use client';

import { useEffect } from 'react';

export function useUnsavedChangesWarning(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [enabled]);
}
