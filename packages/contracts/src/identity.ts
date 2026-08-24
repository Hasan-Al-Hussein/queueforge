import { z } from 'zod';

export const TenantRoleSchema = z.enum(['viewer', 'approver', 'operator', 'tenant_admin']);
export type TenantRole = z.infer<typeof TenantRoleSchema>;

export const PlatformRoleSchema = z.literal('platform_admin');
export type PlatformRole = z.infer<typeof PlatformRoleSchema>;

export const PrincipalKindSchema = z.enum(['user', 'api_client', 'system']);
export type PrincipalKind = z.infer<typeof PrincipalKindSchema>;

export const TenantContextSchema = z
  .object({
    tenantId: z.string().uuid(),
    principalId: z.string().uuid(),
    principalKind: PrincipalKindSchema,
    role: z.union([TenantRoleSchema, PlatformRoleSchema]),
    sessionId: z.string().uuid().optional(),
  })
  .strict();
export type TenantContext = z.infer<typeof TenantContextSchema>;

export const MembershipSchema = z
  .object({
    tenantId: z.string().uuid(),
    tenantName: z.string().min(1).max(160),
    tenantSlug: z.string().min(2).max(80),
    role: TenantRoleSchema,
  })
  .strict();
export type Membership = z.infer<typeof MembershipSchema>;

export const LoginRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string().min(12).max(256),
    tenantId: z.string().uuid().optional(),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthSessionSchema = z
  .object({
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.string().datetime({ offset: true }),
    csrfToken: z.string().min(32),
    memberships: z.array(MembershipSchema),
    selectedTenant: MembershipSchema,
    user: z
      .object({
        id: z.string().uuid(),
        displayName: z.string().min(1),
        email: z.string().email(),
        platformRole: PlatformRoleSchema.nullable(),
      })
      .strict(),
  })
  .strict();
export type AuthSession = z.infer<typeof AuthSessionSchema>;
