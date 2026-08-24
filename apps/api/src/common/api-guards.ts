import { ApiThrottlerGuard } from './api-throttler.guard.js';
import { AccessTokenGuard } from './auth.guard.js';
import { BodyLimitGuard } from './body-limit.guard.js';

/** Guard order is security-significant: reject size, throttle abuse, then verify credentials. */
export const API_GUARD_CLASSES = [BodyLimitGuard, ApiThrottlerGuard, AccessTokenGuard] as const;
