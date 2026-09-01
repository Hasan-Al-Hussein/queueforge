export interface DeferredResourceRelease {
  hold<T>(work: Promise<T>): Promise<T>;
  request(): void;
}

/**
 * Keeps a resource owner alive until non-cancellable asynchronous work that
 * still references it has settled, while making the eventual release exactly
 * once. Callers must not begin new work after requesting release.
 */
export function createDeferredResourceRelease(release: () => void): DeferredResourceRelease {
  let pendingWork = 0;
  let releaseRequested = false;
  let released = false;

  const releaseIfSafe = (): void => {
    if (!releaseRequested || pendingWork !== 0 || released) return;
    released = true;
    release();
  };

  const settleWork = (): void => {
    pendingWork -= 1;
    releaseIfSafe();
  };

  return {
    hold<T>(work: Promise<T>): Promise<T> {
      if (releaseRequested || released) {
        throw new Error('Cannot retain asynchronous work after resource release was requested.');
      }

      pendingWork += 1;
      return work.then(
        (value) => {
          settleWork();
          return value;
        },
        (error: unknown) => {
          settleWork();
          throw error;
        },
      );
    },
    request(): void {
      releaseRequested = true;
      releaseIfSafe();
    },
  };
}
