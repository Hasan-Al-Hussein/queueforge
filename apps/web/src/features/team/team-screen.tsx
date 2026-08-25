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
  LockKeyhole,
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
import {
  MemberFormSchema,
  memberAccessState,
  membershipInputFromForm,
  type MemberForm,
} from './member-policy';

const ROLE_DESCRIPTIONS: Readonly<Record<TenantRole, string>> = {
  viewer: 'Can view request history, request types, and notifications.',
  approver: 'Can review requests assigned for a human decision.',
  operator: 'Can start requests and recover work that needs attention.',
  tenant_admin: 'Can configure request types, delivery connections, and team access.',
};

const ROLE_LABELS: Readonly<Record<TenantRole, string>> = {
  viewer: 'Viewer',
  approver: 'Approver',
  operator: 'Operator',
  tenant_admin: 'Administrator',
};

function selectedRoleDescription(role: unknown): string {
  const parsed = TenantRoleSchema.safeParse(role);
  return ROLE_DESCRIPTIONS[parsed.success ? parsed.data : 'viewer'];
}

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
  const closeRoleEditor = (): void => {
    roleMutation.reset();
    setRoleChange(null);
  };
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
      header: 'Role',
      cell: ({ row }) => (
        <StatusBadge label={ROLE_LABELS[row.original.role]} status={row.original.role} />
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
    {
      id: 'accessAction',
      enableSorting: false,
      header: 'Access',
      cell: ({ row }) => {
        const access = memberAccessState(can('manage_team'), session?.user.id, row.original);
        if (access === 'view_only') return <span className="qf-utility">View only</span>;
        if (access === 'locked') {
          return (
            <span className="qf-role-lock">
              <LockKeyhole size={15} aria-hidden="true" />
              Demo role locked
            </span>
          );
        }
        if (access === 'current_account') {
          return <span className="qf-utility">Current account</span>;
        }
        return (
          <Button
            disabled={!online}
            onClick={() => setRoleChange({ member: row.original, role: row.original.role })}
            tone="quiet"
          >
            Edit access
          </Button>
        );
      },
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
                Add person
              </Button>
            </PermissionGate>
          </>
        }
        description="Add people and give each person one clear responsibility in this workspace."
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
        <Panel
          title="Team members"
          description="Roles change only after Edit access is opened and confirmed. Starter demo roles are locked so the operator and approver walkthrough stays reliable."
        >
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
          title="Roles at a glance"
          description="Use the smallest role that matches the person's everyday job."
        >
          <dl className="qf-role-list">
            {TenantRoleSchema.options.map((role) => (
              <div key={role}>
                <dt>{ROLE_LABELS[role]}</dt>
                <dd>{ROLE_DESCRIPTIONS[role]}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <Dialog
        description="Add someone who already has an account, or create a local account for a new teammate."
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
              Add person
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
            label="Email address"
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
            <label htmlFor="member-role">Role</label>
            <select id="member-role" {...register('role')}>
              {TenantRoleSchema.options.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <p className="qf-field__message">{selectedRoleDescription(membershipInput.role)}</p>
          </div>
        </form>
      </Dialog>

      <Dialog
        description={
          roleChange === null
            ? undefined
            : `Choose what ${roleChange.member.displayName} should be able to do. Nothing changes until you confirm.`
        }
        footer={
          <>
            <Button onClick={closeRoleEditor}>Cancel</Button>
            <Button
              disabled={
                !online || roleChange === null || roleChange.role === roleChange.member.role
              }
              loading={roleMutation.isPending}
              loadingLabel="Updating role"
              onClick={() => {
                if (roleChange !== null) roleMutation.mutate(roleChange);
              }}
              tone="primary"
            >
              Save access
            </Button>
          </>
        }
        onClose={closeRoleEditor}
        open={roleChange !== null}
        title="Edit access"
      >
        {roleMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(roleMutation.error)}
          </div>
        ) : null}
        {roleChange === null ? null : (
          <div className="qf-form-stack">
            <div className="qf-inline-alert" role="note">
              <ShieldCheck size={18} aria-hidden="true" />
              <p>
                Current role: <strong>{ROLE_LABELS[roleChange.member.role]}</strong>. This change
                takes effect immediately and is recorded in the Activity log.
              </p>
            </div>
            <div className="qf-inline-field">
              <label htmlFor="role-change-role">New role</label>
              <select
                id="role-change-role"
                onChange={(event) =>
                  setRoleChange({
                    member: roleChange.member,
                    role: TenantRoleSchema.parse(event.currentTarget.value),
                  })
                }
                value={roleChange.role}
              >
                {TenantRoleSchema.options.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <p className="qf-field__message">{ROLE_DESCRIPTIONS[roleChange.role]}</p>
            </div>
          </div>
        )}
      </Dialog>
    </AppShell>
  );
}
