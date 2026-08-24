'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button, Dialog } from '@queueforge/ui';

import { useUnsavedChangesWarning } from '../hooks/use-unsaved-changes-warning';

type DirtyReader = () => boolean;
type ExitAction = () => void;

const HISTORY_INDEX_KEY = '__queueforgeNavigationIndex';

function historyIndex(state: unknown): number | null {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return null;
  const index = (state as Readonly<Record<string, unknown>>)[HISTORY_INDEX_KEY];
  return typeof index === 'number' && Number.isSafeInteger(index) ? index : null;
}

function indexedHistoryState(state: unknown, index: number): Readonly<Record<string, unknown>> {
  const preserved =
    state !== null && typeof state === 'object' && !Array.isArray(state)
      ? (state as Readonly<Record<string, unknown>>)
      : {};
  return { ...preserved, [HISTORY_INDEX_KEY]: index };
}

interface DirtyNavigationContextValue {
  readonly hasDirtyChanges: () => boolean;
  readonly notifyDirtySourceChange: () => void;
  readonly registerDirtySource: (sourceId: string, readDirty: DirtyReader) => () => void;
  readonly requestExit: (action: ExitAction) => void;
}

const DirtyNavigationContext = createContext<DirtyNavigationContextValue | null>(null);

export function DirtyNavigationProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const dirtyReadersRef = useRef(new Map<string, DirtyReader>());
  const pendingActionRef = useRef<ExitAction | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  const hasDirtyChanges = useCallback(
    (): boolean => Array.from(dirtyReadersRef.current.values()).some((readDirty) => readDirty()),
    [],
  );

  const notifyDirtySourceChange = useCallback((): void => {
    setDirty(hasDirtyChanges());
  }, [hasDirtyChanges]);

  const registerDirtySource = useCallback(
    (sourceId: string, readDirty: DirtyReader): (() => void) => {
      dirtyReadersRef.current.set(sourceId, readDirty);
      notifyDirtySourceChange();
      return () => {
        dirtyReadersRef.current.delete(sourceId);
        notifyDirtySourceChange();
      };
    },
    [notifyDirtySourceChange],
  );

  const requestExit = useCallback(
    (action: ExitAction): void => {
      if (!hasDirtyChanges()) {
        action();
        return;
      }
      pendingActionRef.current = action;
      setConfirmationOpen(true);
    },
    [hasDirtyChanges],
  );

  const cancelExit = useCallback((): void => {
    pendingActionRef.current = null;
    setConfirmationOpen(false);
  }, []);

  const confirmExit = useCallback((): void => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setConfirmationOpen(false);
    action?.();
  }, []);

  useUnsavedChangesWarning(dirty);

  useEffect(() => {
    const browserHistory = window.history;
    const originalPushState = browserHistory.pushState.bind(browserHistory);
    const originalReplaceState = browserHistory.replaceState.bind(browserHistory);
    const initialIndex = historyIndex(browserHistory.state) ?? 0;
    let currentIndex = initialIndex;
    let restoringTraversal: { readonly delta: number } | null = null;
    let allowNextTraversal = false;

    originalReplaceState(
      indexedHistoryState(browserHistory.state, currentIndex),
      '',
      window.location.href,
    );

    const patchedPushState: History['pushState'] = (state, title, url) => {
      currentIndex += 1;
      originalPushState(indexedHistoryState(state, currentIndex), title, url);
    };
    const patchedReplaceState: History['replaceState'] = (state, title, url) => {
      originalReplaceState(indexedHistoryState(state, currentIndex), title, url);
    };
    browserHistory.pushState = patchedPushState;
    browserHistory.replaceState = patchedReplaceState;

    const handlePopState = (event: PopStateEvent): void => {
      const targetIndex = historyIndex(event.state);
      if (targetIndex === null) return;

      if (allowNextTraversal) {
        allowNextTraversal = false;
        currentIndex = targetIndex;
        return;
      }

      if (restoringTraversal !== null) {
        event.stopImmediatePropagation();
        const traversal = restoringTraversal;
        restoringTraversal = null;
        currentIndex = targetIndex;
        requestExit(() => {
          allowNextTraversal = true;
          browserHistory.go(traversal.delta);
        });
        return;
      }

      const delta = targetIndex - currentIndex;
      if (delta === 0 || !hasDirtyChanges()) {
        currentIndex = targetIndex;
        return;
      }

      // popstate is not cancellable. Bounce to the current entry first, then replay
      // the exact traversal only after the shared confirmation is accepted.
      event.stopImmediatePropagation();
      restoringTraversal = { delta };
      browserHistory.go(-delta);
    };

    window.addEventListener('popstate', handlePopState, { capture: true });
    return () => {
      window.removeEventListener('popstate', handlePopState, { capture: true });
      if (browserHistory.pushState === patchedPushState)
        browserHistory.pushState = originalPushState;
      if (browserHistory.replaceState === patchedReplaceState) {
        browserHistory.replaceState = originalReplaceState;
      }
    };
  }, [hasDirtyChanges, requestExit]);

  const value = useMemo<DirtyNavigationContextValue>(
    () => ({ hasDirtyChanges, notifyDirtySourceChange, registerDirtySource, requestExit }),
    [hasDirtyChanges, notifyDirtySourceChange, registerDirtySource, requestExit],
  );

  return (
    <DirtyNavigationContext.Provider value={value}>
      {children}
      <Dialog
        description="Your latest workflow changes are still only in this browser tab."
        footer={
          <>
            <Button onClick={cancelExit}>Keep editing</Button>
            <Button onClick={confirmExit} tone="danger">
              Discard changes and continue
            </Button>
          </>
        }
        onClose={cancelExit}
        open={confirmationOpen}
        title="Continue with unsaved changes?"
      >
        <p>Wait for autosave or retry the failed save to preserve this workflow draft.</p>
      </Dialog>
    </DirtyNavigationContext.Provider>
  );
}

export function useDirtyNavigation(): Pick<
  DirtyNavigationContextValue,
  'hasDirtyChanges' | 'requestExit'
> {
  const value = useContext(DirtyNavigationContext);
  if (value === null) throw new Error('useDirtyNavigation must be used inside its provider.');
  return value;
}

export function useDirtyNavigationSource(dirty: boolean): void {
  const value = useContext(DirtyNavigationContext);
  if (value === null) throw new Error('useDirtyNavigationSource must be used inside its provider.');
  const sourceId = useId();
  const dirtyRef = useRef(dirty);

  useLayoutEffect(
    () => value.registerDirtySource(sourceId, () => dirtyRef.current),
    [sourceId, value],
  );

  useLayoutEffect(() => {
    dirtyRef.current = dirty;
    value.notifyDirtySourceChange();
  }, [dirty, value]);
}
