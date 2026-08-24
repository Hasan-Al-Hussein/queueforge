import { z } from 'zod';

const booleanFromEnvironment = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }
  return value;
}, z.boolean());

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInteger = z.coerce.number().int().positive();
const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const secret = z.string().min(32, 'must contain at least 32 characters');
const encryptionKey = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, 'must be a base64-encoded 32-byte key');

const RuntimeEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_MODE: z.enum(['local', 'test']).default('local'),
    API_HOST: z.ipv4().default('127.0.0.1'),
    API_PORT: port.default(3001),
    WEB_ORIGIN: z.string().url().default('http://127.0.0.1:3100'),
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    REDIS_URL: z.string().url().startsWith('redis://'),
    JWT_ACCESS_SECRET: secret,
    JWT_ISSUER: z.string().min(2).max(100).default('queueforge-local'),
    JWT_AUDIENCE: z.string().min(2).max(100).default('queueforge-api'),
    ACCESS_TOKEN_TTL_SECONDS: positiveInteger.min(60).max(3_600).default(600),
    REFRESH_TOKEN_TTL_SECONDS: positiveInteger.min(300).max(2_592_000).default(604_800),
    REFRESH_FAMILY_TTL_SECONDS: positiveInteger.min(3_600).max(7_776_000).default(2_592_000),
    REFRESH_TOKEN_PEPPER: secret,
    WEBHOOK_MASTER_KEY: encryptionKey,
    REFRESH_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('qf_refresh'),
    CSRF_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('qf_csrf'),
    COOKIE_SECURE: booleanFromEnvironment.default(false),
    TRUST_PROXY: booleanFromEnvironment.default(false),
    LOG_LEVEL: logLevel.default('info'),
    WEBHOOK_CLOCK_SKEW_SECONDS: positiveInteger.min(30).max(900).default(300),
    METRICS_TOKEN: z.string().min(24).optional(),
  })
  .strip();

const WorkerEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    REDIS_URL: z.string().url().startsWith('redis://'),
    WEBHOOK_MASTER_KEY: encryptionKey,
    LOG_LEVEL: logLevel.default('info'),
    OUTBOUND_ALLOWED_HOSTS: z.string().default('127.0.0.1,localhost'),
    OUTBOUND_ALLOW_PRIVATE_NETWORKS: booleanFromEnvironment.default(true),
    OUTBOX_POLL_INTERVAL_MS: positiveInteger.min(100).max(60_000).default(1_000),
    OUTBOX_LEASE_SECONDS: positiveInteger.min(5).max(300).default(30),
    WORKER_CONCURRENCY: positiveInteger.min(1).max(32).default(4),
    WORKER_HEARTBEAT_SECONDS: positiveInteger.min(2).max(300).default(10),
    REQUEST_JOB_TIMEOUT_MS: positiveInteger.min(1_000).max(600_000).default(30_000),
    WEBHOOK_TIMEOUT_MS: positiveInteger.min(100).max(60_000).default(5_000),
  })
  .strip();

const MigrationEnvironmentSchema = z
  .object({
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    MIGRATION_DATABASE_URL: z.string().url().startsWith('postgresql://').optional(),
  })
  .strip();

const SeedEnvironmentSchema = MigrationEnvironmentSchema.extend({
  WEBHOOK_MASTER_KEY: encryptionKey,
  BOOTSTRAP_ADMIN_EMAIL: z.string().email(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(256),
  BOOTSTRAP_TENANT_SLUG: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,78}$/)
    .default('acme-demo'),
  DEMO_WEBHOOK_TARGET_URL: z
    .string()
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'must use http or https',
    })
    .default('http://127.0.0.1:3300/webhooks'),
  SINK_SECRET: secret,
}).strip();

const SinkEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SINK_HOST: z.ipv4().default('127.0.0.1'),
    SINK_PORT: port.default(3300),
    SINK_SECRET: secret,
    SINK_KEY_ID: z.string().min(1).max(100).default('local-v1'),
    SINK_CLOCK_SKEW_SECONDS: positiveInteger.min(30).max(900).default(300),
    LOG_LEVEL: logLevel.default('info'),
  })
  .strip();

const PublicWebEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    NEXT_PUBLIC_API_URL: z.string().url().default('http://127.0.0.1:3001'),
    NEXT_PUBLIC_GRAPHQL_URL: z.string().url().default('http://127.0.0.1:3001/graphql'),
    NEXT_PUBLIC_CSRF_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('qf_csrf'),
  })
  .strip();

export type RuntimeEnvironment = z.infer<typeof RuntimeEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof WorkerEnvironmentSchema>;
export type MigrationEnvironment = z.infer<typeof MigrationEnvironmentSchema>;
export type SeedEnvironment = z.infer<typeof SeedEnvironmentSchema>;
export type SinkEnvironment = z.infer<typeof SinkEnvironmentSchema>;
export type PublicWebEnvironment = z.infer<typeof PublicWebEnvironmentSchema>;

export class EnvironmentValidationError extends Error {
  public readonly issues: readonly z.core.$ZodIssue[];

  public constructor(scope: string, error: z.ZodError) {
    super(
      `Invalid ${scope} environment: ${error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
    this.name = 'EnvironmentValidationError';
    this.issues = error.issues;
  }
}

function parseEnvironment<T>(
  scope: string,
  schema: z.ZodType<T>,
  environment: Record<string, string | undefined>,
): T {
  const result = schema.safeParse(environment);
  if (!result.success) {
    throw new EnvironmentValidationError(scope, result.error);
  }
  return result.data;
}

export function loadRuntimeEnvironment(
  environment: Record<string, string | undefined> = process.env,
): RuntimeEnvironment {
  return parseEnvironment('runtime', RuntimeEnvironmentSchema, environment);
}

export function loadWorkerEnvironment(
  environment: Record<string, string | undefined> = process.env,
): WorkerEnvironment {
  return parseEnvironment('worker', WorkerEnvironmentSchema, environment);
}

export function loadMigrationEnvironment(
  environment: Record<string, string | undefined> = process.env,
): MigrationEnvironment {
  return parseEnvironment('migration', MigrationEnvironmentSchema, environment);
}

export function loadSeedEnvironment(
  environment: Record<string, string | undefined> = process.env,
): SeedEnvironment {
  return parseEnvironment('seed', SeedEnvironmentSchema, environment);
}

export function loadSinkEnvironment(
  environment: Record<string, string | undefined> = process.env,
): SinkEnvironment {
  return parseEnvironment('webhook sink', SinkEnvironmentSchema, environment);
}

export function loadPublicWebEnvironment(
  environment: Record<string, string | undefined> = process.env,
): PublicWebEnvironment {
  const publicValues = {
    NODE_ENV: environment.NODE_ENV,
    NEXT_PUBLIC_API_URL: environment.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_GRAPHQL_URL: environment.NEXT_PUBLIC_GRAPHQL_URL,
    NEXT_PUBLIC_CSRF_COOKIE_NAME: environment.NEXT_PUBLIC_CSRF_COOKIE_NAME,
  };
  return parseEnvironment('public web', PublicWebEnvironmentSchema, publicValues);
}

export function splitCommaSeparated(value: string): readonly string[] {
  return Object.freeze(
    value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

export const environmentSchemas = {
  migration: MigrationEnvironmentSchema,
  publicWeb: PublicWebEnvironmentSchema,
  runtime: RuntimeEnvironmentSchema,
  seed: SeedEnvironmentSchema,
  sink: SinkEnvironmentSchema,
  worker: WorkerEnvironmentSchema,
} as const;
