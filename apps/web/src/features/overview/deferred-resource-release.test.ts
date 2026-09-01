import { describe, expect, it, vi } from 'vitest';

import { createDeferredResourceRelease } from './deferred-resource-release';

describe('createDeferredResourceRelease', () => {
  it('waits for retained asynchronous work before releasing exactly once', async () => {
    let finishWork: (() => void) | undefined;
    const work = new Promise<void>((resolve) => {
      finishWork = resolve;
    });
    const release = vi.fn();
    const resources = createDeferredResourceRelease(release);

    const retainedWork = resources.hold(work);
    resources.request();

    expect(release).not.toHaveBeenCalled();

    finishWork?.();
    await retainedWork;
    resources.request();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases after retained work rejects', async () => {
    const release = vi.fn();
    const resources = createDeferredResourceRelease(release);
    const failure = new Error('compile failed');
    const retainedWork = resources.hold(Promise.reject(failure));

    resources.request();

    await expect(retainedWork).rejects.toBe(failure);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases immediately when no work is retained', () => {
    const release = vi.fn();
    const resources = createDeferredResourceRelease(release);

    resources.request();
    resources.request();

    expect(release).toHaveBeenCalledTimes(1);
  });
});
