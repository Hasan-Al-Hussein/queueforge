import { describe, expect, it } from 'vitest';

import { MemberFormSchema, membershipInputFromForm } from './member-policy';

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
