'use client';

import { useDeferredValue, useMemo, useState } from 'react';
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
  SelectField,
  ShieldCheck,
  StatusBadge,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { ScrollReveal } from '../../components/cinematic-motion';
import { DataTable } from '../../components/data-table';
import { DateTime } from '../../components/format';
import { PaginationControls } from '../../components/pagination-controls';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { RouteHero } from '../../components/route-hero';
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
import styles from './team-screen.module.css';

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

export const MOBILE_MEMBER_PREVIEW_SIZE = 5;
export const TEAM_PAGE_SIZE = 10;

function selectedRoleDescription(role: unknown): string {
  const parsed = TenantRoleSchema.safeParse(role);
  return ROLE_DESCRIPTIONS[parsed.success ? parsed.data : 'viewer'];
}

export function MobileMemberDisclosure({
  expanded,
  onToggle,
  totalMembers,
}: {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly totalMembers: number;
}): React.JSX.Element {
  return (
    <div className={styles.mobileMemberDisclosure}>
      <p aria-live="polite">
        {expanded
          ? `Showing everyone on this page (${String(totalMembers)} people).`
          : `Showing up to ${String(MOBILE_MEMBER_PREVIEW_SIZE)} people. Search checks all ${String(totalMembers)} people on this page.`}
      </p>
      <Button
        aria-controls="team-membership-results"
        aria-expanded={expanded}
        onClick={onToggle}
        tone="secondary"
      >
        {expanded ? 'Show fewer people' : 'Show everyone on this page'}
      </Button>
    </div>
  );
}

function MemberAccessControl({
  canManageTeam,
  currentUserId,
  member,
  online,
  onEdit,
}: {
  readonly canManageTeam: boolean;
  readonly currentUserId: string | undefined;
  readonly member: TeamMember;
  readonly online: boolean;
  readonly onEdit: (member: TeamMember) => void;
}): React.JSX.Element {
  const access = memberAccessState(canManageTeam, currentUserId, member);
  if (access === 'view_only') {
    return (
      <span className={styles.accessState}>
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          <strong>View only</strong>
          <small>Your role cannot change access.</small>
        </span>
      </span>
    );
  }
  if (access === 'locked') {
    return (
      <span className={`${styles.accessState} ${styles.lockedAccess}`}>
        <LockKeyhole size={16} aria-hidden="true" />
        <span>
          <strong>Demo role locked</strong>
          <small>This account keeps its demo role.</small>
        </span>
      </span>
    );
  }
  if (access === 'current_account') {
    return (
      <span className={styles.accessState}>
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          <strong>Current account</strong>
          <small>Another administrator must change this role.</small>
        </span>
      </span>
    );
  }
  return (
    <Button disabled={!online} onClick={() => onEdit(member)} tone="quiet">
      Edit access
    </Button>
  );
}

export function TeamScreen(): React.JSX.Element {
  const pagination = usePagination(TEAM_PAGE_SIZE);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [showAllMobileMembers, setShowAllMobileMembers] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | TenantRole>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'disabled' | 'invited'>(
    'all',
  );
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
      setShowAllMobileMembers(false);
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
  const rows = useMemo(() => teamQuery.data?.items ?? [], [teamQuery.data?.items]);
  const deferredMemberSearch = useDeferredValue(memberSearch.trim().toLowerCase());
  const filteredRows = useMemo(
    () =>
      rows.filter((member) => {
        const matchesSearch =
          deferredMemberSearch === '' ||
          `${member.displayName} ${member.email} ${member.role} ${member.status}`
            .toLowerCase()
            .includes(deferredMemberSearch);
        const matchesRole = roleFilter === 'all' || member.role === roleFilter;
        const matchesStatus = statusFilter === 'all' || member.status === statusFilter;
        return matchesSearch && matchesRole && matchesStatus;
      }),
    [deferredMemberSearch, roleFilter, rows, statusFilter],
  );
  const activeCount = rows.filter((member) => member.status === 'active').length;
  const approverCount = rows.filter((member) => member.role === 'approver').length;
  const administratorCount = rows.filter((member) => member.role === 'tenant_admin').length;
  const columns: readonly ColumnDef<TeamMember, unknown>[] = [
    {
      accessorKey: 'displayName',
      header: 'Member',
      cell: ({ row }) => (
        <div className={styles.memberIdentity}>
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
      cell: ({ row }) => (
        <MemberAccessControl
          canManageTeam={can('manage_team')}
          currentUserId={session?.user.id}
          member={row.original}
          online={online}
          onEdit={(member) => setRoleChange({ member, role: member.role })}
        />
      ),
    },
  ];

  return (
    <AppShell>
      <div className={styles.screen}>
        <RouteHero
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
          description="Add people, review workspace access, and change roles with a confirmed audit record."
          eyebrow="Workspace administration"
          icon={<ShieldCheck size={18} />}
          meta="Role changes require confirmation and are recorded in the Activity log"
          title="Team & access"
        />
        {!can('manage_team') ? (
          <ScrollReveal amount={0.1}>
            <div className="qf-inline-alert" role="note">
              <ShieldCheck size={18} />
              <p>Your role can view the team but cannot add people or change access.</p>
            </div>
          </ScrollReveal>
        ) : null}

        <ScrollReveal amount={0.1}>
          <dl className={styles.summaryStrip} aria-label="Team summary">
            <div>
              <dt>Loaded</dt>
              <dd>{rows.length}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{activeCount}</dd>
            </div>
            <div>
              <dt>Approvers</dt>
              <dd>{approverCount}</dd>
            </div>
            <div>
              <dt>Administrators</dt>
              <dd>{administratorCount}</dd>
            </div>
          </dl>
        </ScrollReveal>

        <ScrollReveal amount={0.08} delay={0.04}>
          <Panel
            className={styles.membersPanel}
            title="Team members"
            description="Protected demo accounts are clearly locked. Role guidance appears when you add or edit a person."
          >
            <div className={styles.filterBar}>
              <InputField
                id="team-members-search"
                label="Search members"
                onChange={(event) => {
                  setShowAllMobileMembers(false);
                  setMemberSearch(event.currentTarget.value);
                }}
                placeholder="Name or email"
                type="search"
                value={memberSearch}
              />
              <SelectField
                id="team-role-filter"
                label="Role"
                onChange={(event) => {
                  setShowAllMobileMembers(false);
                  setRoleFilter(event.currentTarget.value as 'all' | TenantRole);
                }}
                value={roleFilter}
              >
                <option value="all">All roles</option>
                {TenantRoleSchema.options.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="team-status-filter"
                label="Status"
                onChange={(event) => {
                  setShowAllMobileMembers(false);
                  setStatusFilter(
                    event.currentTarget.value as 'active' | 'all' | 'disabled' | 'invited',
                  );
                }}
                value={statusFilter}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="invited">Invited</option>
                <option value="disabled">Disabled</option>
              </SelectField>
              <div className={styles.resultCount}>
                <span>Results</span>
                <output aria-live="polite">{String(filteredRows.length)} shown</output>
                <span aria-hidden="true" className="qf-field__message">
                  {'\u00a0'}
                </span>
              </div>
            </div>
            <QueryState
              empty={teamQuery.isSuccess && rows.length === 0}
              emptyDescription="This tenant has no visible membership records."
              emptyTitle="No members"
              error={teamQuery.error}
              isLoading={teamQuery.isLoading}
              onRetry={() => void teamQuery.refetch()}
            >
              <div className={styles.memberTable} data-mobile-expanded={showAllMobileMembers}>
                <div className={styles.memberResults} id="team-membership-results">
                  {filteredRows.length === 0 ? (
                    <div className={styles.localEmpty} role="status">
                      No team member matches these filters.
                    </div>
                  ) : null}
                  <div className={styles.desktopMemberTable}>
                    <DataTable
                      ariaLabel="Tenant memberships"
                      columns={columns}
                      getRowId={(row) => row.id}
                      rows={filteredRows}
                      stickyLastColumn
                    />
                  </div>
                  <div className={styles.mobileMemberList} role="list">
                    {filteredRows.map((member, index) => (
                      <article
                        className={styles.mobileMember}
                        data-mobile-hidden={index >= MOBILE_MEMBER_PREVIEW_SIZE ? 'true' : 'false'}
                        key={member.id}
                        role="listitem"
                      >
                        <header>
                          <div className={styles.memberIdentity}>
                            <strong>{member.displayName}</strong>
                            <span>{member.email}</span>
                          </div>
                          <StatusBadge label={ROLE_LABELS[member.role]} status={member.role} />
                        </header>
                        <dl className={styles.memberMeta}>
                          <div>
                            <dt>Status</dt>
                            <dd>
                              <StatusBadge status={member.status} />
                            </dd>
                          </div>
                          <div>
                            <dt>Joined</dt>
                            <dd>
                              <DateTime value={member.joinedAt} />
                            </dd>
                          </div>
                        </dl>
                        <MemberAccessControl
                          canManageTeam={can('manage_team')}
                          currentUserId={session?.user.id}
                          member={member}
                          online={online}
                          onEdit={(selectedMember) =>
                            setRoleChange({ member: selectedMember, role: selectedMember.role })
                          }
                        />
                      </article>
                    ))}
                  </div>
                </div>
                {filteredRows.length <= MOBILE_MEMBER_PREVIEW_SIZE ? null : (
                  <MobileMemberDisclosure
                    expanded={showAllMobileMembers}
                    onToggle={() => setShowAllMobileMembers((current) => !current)}
                    totalMembers={filteredRows.length}
                  />
                )}
              </div>
            </QueryState>
            {teamQuery.data?.meta === undefined ? null : (
              <PaginationControls
                ariaLabel="Team memberships"
                disabled={teamQuery.isFetching}
                meta={teamQuery.data.meta}
                onPageChange={(page) => {
                  setShowAllMobileMembers(false);
                  pagination.setPage(page);
                }}
                onPageSizeChange={(pageSize) => {
                  setShowAllMobileMembers(false);
                  pagination.setPageSize(pageSize);
                }}
                page={pagination.page}
                pageSize={pagination.pageSize}
              />
            )}
          </Panel>
        </ScrollReveal>
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
        title="Add person"
      >
        {inviteMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(inviteMutation.error)}
          </div>
        ) : null}
        <form
          className={`${styles.inviteForm} qf-form-stack`}
          onSubmit={(event) => void submitInvite(event)}
          noValidate
        >
          <section className={styles.dialogStep} aria-labelledby="member-identity-step">
            <div className={styles.dialogStepHeading}>
              <span aria-hidden="true">01</span>
              <div>
                <h3 id="member-identity-step">Identify the person</h3>
                <p>Existing QueueForge users need only their email address.</p>
              </div>
            </div>
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
          </section>
          <section className={styles.dialogStep} aria-labelledby="member-responsibility-step">
            <div className={styles.dialogStepHeading}>
              <span aria-hidden="true">02</span>
              <div>
                <h3 id="member-responsibility-step">Choose one responsibility</h3>
                <p>The description below updates before anything is saved.</p>
              </div>
            </div>
            <SelectField
              helper={selectedRoleDescription(membershipInput.role)}
              id="member-role"
              label="Role"
              {...register('role')}
            >
              {TenantRoleSchema.options.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </SelectField>
          </section>
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
            <SelectField
              helper={ROLE_DESCRIPTIONS[roleChange.role]}
              id="role-change-role"
              label="New role"
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
            </SelectField>
          </div>
        )}
      </Dialog>
    </AppShell>
  );
}
