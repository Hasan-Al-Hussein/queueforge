import { describe, expect, it } from 'vitest';

import { isLoginPath } from './app-providers';

describe('isLoginPath', () => {
  it.each(['/login', '/login/', '/login///'])('accepts the packaged login path %s', (pathname) => {
    expect(isLoginPath(pathname)).toBe(true);
  });

  it.each(['/', '/login-help', '/requests'])('rejects the protected path %s', (pathname) => {
    expect(isLoginPath(pathname)).toBe(false);
  });
});
