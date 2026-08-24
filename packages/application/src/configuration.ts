import type { RuntimeEnvironment } from '@queueforge/config';

export const RUNTIME_ENVIRONMENT = Symbol('QUEUEFORGE_RUNTIME_ENVIRONMENT');
export type RuntimeEnvironmentToken = RuntimeEnvironment;
