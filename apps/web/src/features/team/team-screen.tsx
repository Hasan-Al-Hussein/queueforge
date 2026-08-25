'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm, useWatch } from 'react-hook-form';

import { TenantRoleSchema, type TenantRole } from '@queueforge/contracts';
import {
  Button,
  Dialog,
  Eye,
  EyeOff,
  InputField,
  Panel,
  Plus,
  RefreshCw,
  ShieldCheck,
  StatusBadge,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { DataTable } from '../../components/data-table';
import { DateTime } from '../../components/format';
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { PagedTeamSchema, TeamMemberSchema, type TeamMember } from '../../domain/models';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';
import { MemberFormSchema, membershipInputFromForm, type MemberForm } from './member-policy';

const ROLE_DESCRIPTIONS: Readonly<Record<TenantRole, string>> = {
  viewer: 'Read tenant workflows and operational history.',
  approver: 'Viewer access plus approval decisions.',
  operator: 'Submit, cancel, retry, and replay operational work.',
  tenant_admin: 'All tenant configuration, membership, and operational permissions.',
};

export function TeamScreen(): React.JSX.Element {
  const pagination = usePagination();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [roleChange, setRoleChange] = useState<{
    readonly member: TeamMember;
    readonly role: TenantRole;
  } | null>(null);
  const { can, online, session } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const teamQuery = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['team', pagination.page, pagination.pageSize],
    queryFn: ({ signal }) =>
      apiRequest(`${routes.team}?${pageSearchParams(pagination).toString()}`, {
        schema: PagedTeamSchema,
        signal,
      }),
  });
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
  } = useForm<MemberForm>({
    defaultValues: { displayName: '', email: '', initialPassword: '', role: 'viewer' },
    mode: 'onBlur',
    resolver: zodResolver(MemberFormSchema),
  });
  const membershipInput = useWatch({ control });
  const membershipCreationKey = useIdempotencyKeyLease(JSON.stringify(membershipInput));
  const inviteMutation = useMutation({
    mutationFn: (input: MemberForm) =>
      apiRequest(routes.team, {
        body: membershipInputFromForm(input),
        idempotencyKey: membershipCreationKey.acquire(),
        method: 'POST',
        schema: TeamMemberSchema,
      }),
    onSuccess: async () => {
      membershipCreationKey.clear();
      notify('Tenant membership created.', 'success');
      reset();
      setShowInitialPassword(false);
      setInviteOpen(false);
      pagination.resetPage();
      await queryClient.invalidateQueries({ queryKey: ['team'] });
    },
  });
  const roleMutation = useMutation({
    mutationFn: ({ member, role }: { readonly member: TeamMember; readonly role: TenantRole }) =>
      apiRequest(routes.teamMember(member.id), {
        body: { role },
        method: 'PATCH',
        schema: TeamMemberSchema,
      }),
    onSuccess: async () => {
      notify('Tenant role updated.', 'success');
      setRoleChange(null);
      await queryClient.invalidateQueries({ queryKey: ['team'] });
    },
  });
  const submitInvite = handleSubmit(async (values) => inviteMutation.mutateAsync(values));
  const closeInvite = (): void => {
    membershipCreationKey.clear();
    inviteMutation.reset();
    reset();
    setShowInitialPassword(false);
    setInviteOpen(false);
  };
  const rows = teamQuery.data?.items ?? [];
  const columns: readonly ColumnDef<TeamMember, unknown>[] = [
    {
      accessorKey: 'displayName',
      header: 'Member',
      cell: ({ row }) => (
        <div>
          <strong>{row.original.displayName}</strong>
          <div className="qf-utility">{row.original.email}</div>
        </div>
      ),
    },
    {
      accessorKey: 'role',
      header: 'Tenant role',
      cell: ({ row }) =>
        can('manage_team') && session?.user.id !== row.original.id ? (
          <select
            aria-label={`Role for ${row.original.displayName}`}
            className="qf-table-select"
            disabled={!online}
            onChange={(event) =>
              setRoleChange({
                member: row.original,
                role: TenantRoleSchema.parse(event.currentTarget.value),
              })
            }
            value={row.original.role}
          >
            {TenantRoleSchema.options.map((role) => (
              <option key={role} value={role}>
                {role.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        ) : (
          <span>{row.original.role.replaceAll('_', ' ')}</span>
        ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => <StatusBadge status={String(getValue())} />,
    },
    {
      accessorKey: 'joinedAt',
      header: 'Joined',
      cell: ({ getValue }) => <DateTime value={String(getValue())} />,
    },
  ];

  return (
    <AppShell>
      <PageHeader
        actions={
          <>
            <Button
              icon={<RefreshCw size={16} />}
              loading={teamQuery.isFetching}
              onClick={() => void teamQuery.refetch()}
            >
              Refresh
            </Button>
            <PermissionGate permission="manage_team">
              <Button
                disabled={!online}
                icon={<Plus size={16} />}
                onClick={() => setInviteOpen(true)}
                tone="primary"
              >
                Add member
              </Button>
            </PermissionGate>
          </>
        }
        description="Invite people, understand their responsibilities, and control what each role can do."
        eyebrow="Manage your organization"
        title="People & access"
      />
      {!can('manage_team') ? (
        <div className="qf-inline-alert" role="note">
          <ShieldCheck size={18} />
          <p>
            Your role may inspect membership but cannot create or change it. Role enforcement
            happens again at every API and resolver boundary.
          </p>
        </div>
      ) : null}
      <div className="qf-content-grid qf-content-grid--detail">
        <Panel title="Memberships">
          <QueryState
            empty={teamQuery.isSuccess && rows.length === 0}
            emptyDescription="This tenant has no visible membership records."
            emptyTitle="No members"
            error={teamQuery.error}
            isLoading={teamQuery.isLoading}
            onRetry={() => void teamQuery.refetch()}
          >
            <DataTable
              ariaLabel="Tenant memberships"
              columns={columns}
              getRowId={(row) => row.id}
              rows={rows}
              search={{
                label: 'Search members',
                placeholder: 'Name, email, role, or status',
                text: (row) => `${row.displayName} ${row.email} ${row.role} ${row.status}`,
              }}
            />
          </QueryState>
          {teamQuery.data?.meta === undefined ? null : (
            <PaginationControls
              ariaLabel="Team memberships"
              disabled={teamQuery.isFetching}
              meta={teamQuery.data.meta}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
              page={pagination.page}
              pageSize={pagination.pageSize}
            />
          )}
        </Panel>
        <Panel
          title="What each role can do"
          description="Permissions stay limited by default, and every administrative change is recorded."
        >
          <dl className="qf-role-list">
            {TenantRoleSchema.options.map((role) => (
              <div key={role}>
                <dt>{role.replaceAll('_', ' ')}</dt>
                <dd>{ROLE_DESCRIPTIONS[role]}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <Dialog
        description="Add an existing identity by email, or provide a display name and initial password to create a new user and membership together."
        footer={
          <>
            <Button onClick={closeInvite}>Cancel</Button>
            <Button
              disabled={!online}
              loading={inviteMutation.isPending}
              loadingLabel="Adding member"
              onClick={() => void submitInvite()}
              tone="primary"
            >
              Add membership
            </Button>
          </>
        }
        onClose={closeInvite}
        open={inviteOpen}
        title="Add tenant member"
      >
        {inviteMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(inviteMutation.error)}
          </div>
        ) : null}
        <form className="qf-form-stack" onSubmit={(event) => void submitInvite(event)} noValidate>
          <InputField
            autoComplete="email"
            error={errors.email?.message}
            id="member-email"
            label="User email"
            required
            type="email"
            {...register('email')}
          />
          <InputField
            autoComplete="name"
            error={errors.displayName?.message}
            helper="Required only when this email does not already belong to a QueueForge user."
            id="member-display-name"
            label="Display name"
            type="text"
            {...register('displayName')}
          />
          <div className="qf-password-field">
            <InputField
              autoComplete="new-password"
              error={errors.initialPassword?.message}
              helper="Required for a new user. Use at least 12 characters; it is sent once and never retained in this browser."
              id="member-initial-password"
              label="Initial password"
              minLength={12}
              type={showInitialPassword ? 'text' : 'password'}
              {...register('initialPassword')}
            />
            <Button
              aria-label={showInitialPassword ? 'Hide initial password' : 'Show initial password'}
              className="qf-password-toggle"
              icon={showInitialPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              onClick={() => setShowInitialPassword((visible) => !visible)}
              tone="quiet"
            />
          </div>
          <div className="qf-inline-field">
            <label htmlFor="member-role">Tenant role</label>
            <select id="member-role" {...register('role')}>
              {TenantRoleSchema.options.map((role) => (
                <option key={role} value={role}>
                  {role.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
            <p className="qf-field__message">{ROLE_DESCRIPTIONS.viewer}</p>
          </div>
        </form>
      </Dialog>

      <Dialog
        description={
          roleChange === null
            ? undefined
            : `${roleChange.member.displayName} will receive ${ROLE_DESCRIPTIONS[roleChange.role]}`
        }
        footer={
          <>
            <Button onClick={() => setRoleChange(null)}>Cancel</Button>
            <Button
              disabled={!online}
              loading={roleMutation.isPending}
              loadingLabel="Updating role"
              onClick={() => {
                if (roleChange !== null) roleMutation.mutate(roleChange);
              }}
              tone="primary"
            >
              Confirm role change
            </Button>
          </>
        }
        onClose={() => setRoleChange(null)}
        open={roleChange !== null}
        title="Change tenant role?"
      >
        {roleMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(roleMutation.error)}
          </div>
        ) : null}
        <p>The server checks the current membership and prevents unauthorized privilege changes.</p>
      </Dialog>
    </AppShell>
  );
}
