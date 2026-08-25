import { z } from 'zod';

import { TenantRoleSchema, type TenantRole } from '@queueforge/contracts';

export const MemberFormSchema = z.object({
  displayName: z.union([z.literal(''), z.string().trim().min(1).max(160)]).optional(),
  email: z.string().trim().toLowerCase().email().max(320),
  initialPassword: z.union([z.literal(''), z.string().min(12).max(256)]).optional(),
  role: TenantRoleSchema,
});
export type MemberForm = z.infer<typeof MemberFormSchema>;

export interface AddMembershipInput {
  readonly displayName?: string;
  readonly email: string;
  readonly initialPassword?: string;
  readonly role: TenantRole;
}

export type MemberAccessState = 'current_account' | 'editable' | 'locked' | 'view_only';

export function memberAccessState(
  canManageTeam: boolean,
  currentUserId: string | undefined,
  member: { readonly id: string; readonly roleLocked: boolean },
): MemberAccessState {
  if (!canManageTeam) return 'view_only';
  if (member.roleLocked) return 'locked';
  if (currentUserId === member.id) return 'current_account';
  return 'editable';
}

export function membershipInputFromForm(input: MemberForm): AddMembershipInput {
  const displayName = input.displayName?.trim();
  const initialPassword = input.initialPassword;
  return {
    email: input.email,
    role: input.role,
    ...(displayName !== undefined && displayName !== '' ? { displayName } : {}),
    ...(initialPassword !== undefined && initialPassword !== '' ? { initialPassword } : {}),
  };
}
