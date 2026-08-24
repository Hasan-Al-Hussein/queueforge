import { ApiThrottlerGuard } from './common/api-throttler.guard.js';
import { API_GUARD_CLASSES } from './common/api-guards.js';
import { AccessTokenGuard } from './common/auth.guard.js';
import { BodyLimitGuard } from './common/body-limit.guard.js';

describe('ApiModule guard order', () => {
  it('rate-limits before performing expensive credential verification', () => {
    expect(API_GUARD_CLASSES).toEqual([BodyLimitGuard, ApiThrottlerGuard, AccessTokenGuard]);
  });
});
