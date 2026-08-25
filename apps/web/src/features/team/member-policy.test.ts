import { describe, expect, it } from 'vitest';

import { MemberFormSchema, memberAccessState, membershipInputFromForm } from './member-policy';

describe('add-membership policy', () => {
  it('omits new-user credentials when adding an existing identity', () => {
    const input = MemberFormSchema.parse({
      displayName: '',
      email: ' existing@example.test ',
      initialPassword: '',
      role: 'viewer',
    });

    expect(membershipInputFromForm(input)).toEqual({
      email: 'existing@example.test',
      role: 'viewer',
    });
  });

  it('preserves display name and initial password for a new identity', () => {
    const input = MemberFormSchema.parse({
      displayName: ' Queue Operator ',
      email: 'operator@example.test',
      initialPassword: 'correct horse battery staple',
      role: 'operator',
    });

    expect(membershipInputFromForm(input)).toEqual({
      displayName: 'Queue Operator',
      email: 'operator@example.test',
      initialPassword: 'correct horse battery staple',
      role: 'operator',
    });
  });

  it('rejects a non-empty initial password shorter than 12 characters', () => {
    expect(
      MemberFormSchema.safeParse({
        displayName: 'Queue Operator',
        email: 'operator@example.test',
        initialPassword: 'too-short',
        role: 'operator',
      }).success,
    ).toBe(false);
  });
});

describe('member access policy', () => {
  const editableMember = { id: 'member-id', roleLocked: false };

  it('keeps team access read-only without team management permission', () => {
    expect(memberAccessState(false, 'admin-id', editableMember)).toBe('view_only');
  });

  it('honors a server-backed role lock before offering an edit action', () => {
    expect(memberAccessState(true, 'admin-id', { id: 'demo-member-id', roleLocked: true })).toBe(
      'locked',
    );
  });

  it('does not offer self-demotion in the team screen', () => {
    expect(memberAccessState(true, 'member-id', editableMember)).toBe('current_account');
  });

  it('offers deliberate editing for another unlocked member', () => {
    expect(memberAccessState(true, 'admin-id', editableMember)).toBe('editable');
  });
});
