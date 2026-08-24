'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { z } from 'zod';

import { DraftAutosaveInputSchema, type DraftAutosaveInput } from '@queueforge/contracts';
import {
  AlertTriangle,
  ArrowLeft,
  Button,
  Check,
  CloudOff,
  Copy,
  Dialog,
  InputField,
  LoaderCircle,
  Panel,
  RefreshCw,
  Save,
  StatePanel,
  StatusBadge,
  TextareaField,
  Upload,
} from '@queueforge/ui';

import { apiRequest, ApiProblem, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { PageHeader } from '../../components/page-header';
import { PermissionSurface } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { WorkflowDetailSchema, type WorkflowDetail } from '../../domain/models';
import {
  useDirtyNavigation,
  useDirtyNavigationSource,
} from '../../providers/dirty-navigation-provider';
import { useStaticSearchParam } from '../../hooks/use-static-search-param';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';
import { AutosaveConflictActions } from './autosave-conflict-actions';

export interface EditorForm {
  readonly description: string;
  readonly isEnabled: boolean;
  readonly name: string;
  readonly preventSelfApproval: boolean;
  readonly processingConfigText: string;
  readonly requestSchemaText: string;
  readonly requiresApproval: boolean;
  readonly targetsText: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'invalid' | 'error' | 'conflict';

export type DraftProblemField = keyof EditorForm | 'root';

const DRAFT_FIELD_BY_INPUT_PATH: Readonly<Record<string, Exclude<DraftProblemField, 'root'>>> = {
  description: 'description',
  isEnabled: 'isEnabled',
  name: 'name',
  preventSelfApproval: 'preventSelfApproval',
  processingConfig: 'processingConfigText',
  requestSchema: 'requestSchemaText',
  requiresApproval: 'requiresApproval',
  targets: 'targetsText',
};

const EDITOR_CONTROL_ID_BY_FIELD: Readonly<Record<Exclude<DraftProblemField, 'root'>, string>> = {
  description: 'editor-description',
  isEnabled: 'editor-is-enabled',
  name: 'editor-name',
  preventSelfApproval: 'editor-prevent-self-approval',
  processingConfigText: 'editor-processing-policy',
  requestSchemaText: 'editor-request-schema',
  requiresApproval: 'editor-requires-approval',
  targetsText: 'editor-targets',
};

export function draftProblemField(path: readonly PropertyKey[]): DraftProblemField {
  const root = path[0];
  return typeof root === 'string' ? (DRAFT_FIELD_BY_INPUT_PATH[root] ?? 'root') : 'root';
}

export function focusDraftProblemField(field: Exclude<DraftProblemField, 'root'>): void {
  document.getElementById(EDITOR_CONTROL_ID_BY_FIELD[field])?.focus();
}

export function shouldScheduleAutosave({
  editable,
  lastAttemptedSignature,
  lastSavedSignature,
  online,
  saveState,
  signature,
}: {
  readonly editable: boolean;
  readonly lastAttemptedSignature: string | null;
  readonly lastSavedSignature: string;
  readonly online: boolean;
  readonly saveState: SaveState;
  readonly signature: string;
}): boolean {
  return (
    editable &&
    online &&
    signature !== lastSavedSignature &&
    signature !== lastAttemptedSignature &&
    saveState !== 'saving' &&
    saveState !== 'conflict'
  );
}

function formFromWorkflow(workflow: WorkflowDetail): EditorForm {
  return {
    description: workflow.description ?? '',
    isEnabled: workflow.isEnabled,
    name: workflow.name,
    preventSelfApproval: workflow.preventSelfApproval,
    processingConfigText: JSON.stringify(workflow.processingConfig, null, 2),
    requestSchemaText: JSON.stringify(workflow.requestSchema, null, 2),
    requiresApproval: workflow.requiresApproval,
    targetsText: JSON.stringify(workflow.targets, null, 2),
  };
}

export function draftFromForm(
  values: EditorForm,
  expectedRevision: number,
): {
  readonly input?: DraftAutosaveInput;
  readonly problem?: {
    readonly field: DraftProblemField;
    readonly message: string;
  };
} {
  let requestSchema: unknown;
  let processingConfig: unknown;
  let targets: unknown;
  try {
    requestSchema = JSON.parse(values.requestSchemaText) as unknown;
  } catch {
    return {
      problem: { field: 'requestSchemaText', message: 'Request schema must be valid JSON.' },
    };
  }
  try {
    processingConfig = JSON.parse(values.processingConfigText) as unknown;
  } catch {
    return {
      problem: { field: 'processingConfigText', message: 'Processing policy must be valid JSON.' },
    };
  }
  try {
    targets = JSON.parse(values.targetsText) as unknown;
  } catch {
    return { problem: { field: 'targetsText', message: 'Workflow targets must be valid JSON.' } };
  }
  const parsed = DraftAutosaveInputSchema.safeParse({
    description: values.description.trim() === '' ? null : values.description,
    expectedRevision,
    name: values.name,
    isEnabled: values.isEnabled,
    preventSelfApproval: values.preventSelfApproval,
    processingConfig,
    requestSchema,
    requiresApproval: values.requiresApproval,
    targets,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = draftProblemField(issue?.path ?? []);
    return { problem: { field, message: issue?.message ?? 'Draft values are invalid.' } };
  }
  return { input: parsed.data };
}

interface WorkflowContentFieldsProps {
  readonly editable: boolean;
  readonly errors: FieldErrors<EditorForm>;
  readonly register: UseFormRegister<EditorForm>;
}

export function WorkflowContentFields({
  editable,
  errors,
  register,
}: WorkflowContentFieldsProps): React.JSX.Element {
  return (
    <>
      <InputField
        disabled={!editable}
        error={errors.name?.message}
        id="editor-name"
        label="Workflow name"
        maxLength={160}
        required
        {...register('name', { required: 'Name is required.' })}
      />
      <TextareaField
        disabled={!editable}
        error={errors.description?.message}
        id="editor-description"
        label="Description"
        maxLength={2000}
        {...register('description')}
      />
      <TextareaField
        className="qf-json-editor"
        disabled={!editable}
        error={errors.requestSchemaText?.message}
        helper="JSON Schema used to validate every submitted payload."
        id="editor-request-schema"
        label="Request JSON Schema"
        required
        spellCheck={false}
        {...register('requestSchemaText')}
      />
      <TextareaField
        className="qf-json-editor"
        disabled={!editable}
        error={errors.processingConfigText?.message}
        helper="Local execution policy such as attempts and timeout."
        id="editor-processing-policy"
        label="Processing policy JSON"
        required
        spellCheck={false}
        {...register('processingConfigText')}
      />
      <TextareaField
        className="qf-json-editor"
        disabled={!editable}
        error={errors.targetsText?.message}
        helper="Ordered targets (0–99): processor, webhook, or notification. Webhook configs reference a server-managed endpoint; never paste a secret."
        id="editor-targets"
        label="Execution targets JSON"
        required
        spellCheck={false}
        {...register('targetsText')}
      />
    </>
  );
}

type WorkflowPolicyFieldsProps = WorkflowContentFieldsProps;

export function WorkflowPolicyFields({
  editable,
  errors,
  register,
}: WorkflowPolicyFieldsProps): React.JSX.Element {
  const policies = [
    {
      description: 'Disabled workflows remain visible but reject new intake.',
      field: 'isEnabled',
      id: 'editor-is-enabled',
      label: 'Accept new requests',
    },
    {
      description: 'Hold validated requests before durable queue dispatch.',
      field: 'requiresApproval',
      id: 'editor-requires-approval',
      label: 'Require approval',
    },
    {
      description: 'The requester cannot decide their own approval task.',
      field: 'preventSelfApproval',
      id: 'editor-prevent-self-approval',
      label: 'Prevent self-approval',
    },
  ] as const;

  return (
    <>
      {policies.map((policy) => {
        const error = errors[policy.field]?.message;
        return (
          <div
            className={error === undefined ? 'qf-field' : 'qf-field qf-field--error'}
            key={policy.field}
          >
            <label className="qf-checkbox" htmlFor={policy.id}>
              <input
                aria-describedby={`${policy.id}-message`}
                aria-invalid={error !== undefined}
                disabled={!editable}
                id={policy.id}
                type="checkbox"
                {...register(policy.field)}
              />
              <span>
                <strong>{policy.label}</strong>
                <br />
                {policy.description}
              </span>
            </label>
            <p
              aria-live={error === undefined ? 'off' : 'polite'}
              className="qf-field__message"
              id={`${policy.id}-message`}
            >
              {error ?? '\u00a0'}
            </p>
          </div>
        );
      })}
    </>
  );
}

function SaveIndicator({
  error,
  state,
}: {
  readonly error: string | null;
  readonly state: SaveState;
}): React.JSX.Element {
  if (state === 'saving')
    return (
      <span className="qf-save-state">
        <LoaderCircle className="qf-spin" size={15} />
        Saving draft
      </span>
    );
  if (state === 'saved')
    return (
      <span className="qf-save-state qf-save-state--saved">
        <Check size={15} />
        All changes saved
      </span>
    );
  if (state === 'conflict')
    return (
      <span className="qf-save-state qf-save-state--error">
        <AlertTriangle size={15} />
        Revision conflict
      </span>
    );
  if (state === 'error')
    return (
      <span className="qf-save-state qf-save-state--error">
        <CloudOff size={15} />
        {error ?? 'Save failed'}
      </span>
    );
  if (state === 'invalid')
    return (
      <span className="qf-save-state qf-save-state--error">
        <AlertTriangle size={15} />
        Fix validation errors
      </span>
    );
  return (
    <span className="qf-save-state">
      <Save size={15} />
      Draft autosave ready
    </span>
  );
}

export function WorkflowEditorScreen(): React.JSX.Element {
  const search = useStaticSearchParam('id');
  const router = useRouter();
  const workflowId =
    search.value !== null && z.string().uuid().safeParse(search.value).success
      ? search.value
      : null;
  const { can, online } = useAuth();
  const { requestExit } = useDirtyNavigation();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const workflowQuery = useQuery({
    enabled: workflowId !== null,
    queryKey: ['workflow', workflowId],
    queryFn: ({ signal }) => {
      if (workflowId === null) throw new Error('Workflow ID is missing.');
      return apiRequest(routes.workflow(workflowId), { schema: WorkflowDetailSchema, signal });
    },
  });
  const {
    clearErrors,
    formState: { errors },
    register,
    reset,
    setError,
    watch,
  } = useForm<EditorForm>({
    defaultValues: {
      description: '',
      isEnabled: true,
      name: '',
      preventSelfApproval: true,
      processingConfigText:
        '{\n  "durationMs": 250,\n  "failuresBeforeSuccess": 0,\n  "maxAttempts": 5\n}',
      requestSchemaText:
        '{\n  "type": "object",\n  "additionalProperties": false,\n  "properties": {}\n}',
      requiresApproval: true,
      targetsText:
        '[\n  {\n    "targetKind": "processor",\n    "position": 0,\n    "config": {\n      "handler": "demo"\n    }\n  }\n]',
    },
    mode: 'onBlur',
  });
  // React Hook Form owns mutable field subscriptions; React Compiler intentionally skips this call.
  // eslint-disable-next-line react-hooks/incompatible-library
  const values = watch();
  const signature = JSON.stringify(values);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activateOpen, setActivateOpen] = useState(false);
  const [conflictDraft, setConflictDraft] = useState<DraftAutosaveInput | null>(null);
  const revisionRef = useRef(1);
  const lastAttemptedRef = useRef<string | null>(null);
  const lastSavedRef = useRef('');
  const loadedVersionRef = useRef<string | null>(null);
  const workflow = workflowQuery.data;
  const editable = workflow?.versionStatus === 'draft' && can('configure_workflows');
  const dirty =
    editable &&
    loadedVersionRef.current === workflow.versionId &&
    signature !== lastSavedRef.current;

  useDirtyNavigationSource(dirty);

  useEffect(() => {
    const workflow = workflowQuery.data;
    if (workflow === undefined || loadedVersionRef.current === workflow.versionId) return;
    const form = formFromWorkflow(workflow);
    reset(form);
    revisionRef.current = workflow.revision;
    lastAttemptedRef.current = null;
    lastSavedRef.current = JSON.stringify(form);
    loadedVersionRef.current = workflow.versionId;
    setSaveState('saved');
    setSaveError(null);
  }, [reset, workflowQuery.data]);

  const persistDraft = useCallback(
    async (
      form: EditorForm,
      expectedRevision = revisionRef.current,
    ): Promise<WorkflowDetail | null> => {
      if (workflowId === null) return null;
      const formSignature = JSON.stringify(form);
      lastAttemptedRef.current = formSignature;
      clearErrors();
      const draft = draftFromForm(form, expectedRevision);
      if (draft.input === undefined) {
        const problem = draft.problem;
        if (problem !== undefined) {
          if (problem.field === 'root') {
            setError('root.draft', { message: problem.message });
          } else {
            setError(problem.field, { message: problem.message }, { shouldFocus: true });
            focusDraftProblemField(problem.field);
          }
        }
        setSaveState('invalid');
        return null;
      }
      setSaveState('saving');
      setSaveError(null);
      try {
        const saved = await apiRequest(routes.workflowDraft(workflowId), {
          body: draft.input,
          method: 'PATCH',
          schema: WorkflowDetailSchema,
        });
        revisionRef.current = saved.revision;
        lastAttemptedRef.current = null;
        lastSavedRef.current = formSignature;
        loadedVersionRef.current = saved.versionId;
        queryClient.setQueryData(['workflow', workflowId], saved);
        setSaveState('saved');
        return saved;
      } catch (error) {
        if (error instanceof ApiProblem && error.code === 'STALE_REVISION') {
          setConflictDraft(draft.input);
          setSaveState('conflict');
          return null;
        }
        setSaveError(formatProblem(error));
        setSaveState('error');
        return null;
      }
    },
    [clearErrors, queryClient, setError, workflowId],
  );

  useEffect(() => {
    if (
      !shouldScheduleAutosave({
        editable,
        lastAttemptedSignature: lastAttemptedRef.current,
        lastSavedSignature: lastSavedRef.current,
        online,
        saveState,
        signature,
      })
    )
      return;
    const timer = window.setTimeout(() => {
      void persistDraft(values);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [editable, online, persistDraft, saveState, signature, values]);

  const activateMutation = useMutation({
    mutationFn: async () => {
      if (workflowId === null) throw new Error('Workflow ID is missing.');
      if (signature !== lastSavedRef.current) {
        const saved = await persistDraft(values);
        if (saved === null) throw new Error('Save the draft before activation.');
      }
      return apiRequest(routes.workflowActivate(workflowId), {
        method: 'POST',
        schema: WorkflowDetailSchema,
      });
    },
    onSuccess: (workflow) => {
      queryClient.setQueryData(['workflow', workflowId], workflow);
      setActivateOpen(false);
      notify(`Version ${String(workflow.versionNo)} activated.`, 'success');
    },
  });
  const cloneMutation = useMutation({
    mutationFn: async () => {
      if (workflowId === null) throw new Error('Workflow ID is missing.');
      return apiRequest(routes.workflowCloneDraft(workflowId), {
        method: 'POST',
        schema: WorkflowDetailSchema,
      });
    },
    onSuccess: (workflow) => {
      queryClient.setQueryData(['workflow', workflow.id], workflow);
      notify('New draft cloned from the active version.', 'success');
      if (workflow.id !== workflowId) {
        router.push(`/workflows/editor?id=${encodeURIComponent(workflow.id)}`);
      }
    },
  });

  const loadServerCopy = async (): Promise<void> => {
    const result = await workflowQuery.refetch();
    if (result.data !== undefined) {
      const form = formFromWorkflow(result.data);
      reset(form);
      revisionRef.current = result.data.revision;
      lastAttemptedRef.current = null;
      lastSavedRef.current = JSON.stringify(form);
      loadedVersionRef.current = result.data.versionId;
      setConflictDraft(null);
      setSaveState('saved');
      notify('Loaded the latest server revision.', 'info');
    }
  };

  const keepLocalCopy = async (): Promise<void> => {
    if (workflowId === null || conflictDraft === null) return;
    try {
      const latest = await apiRequest(routes.workflow(workflowId), {
        schema: WorkflowDetailSchema,
      });
      revisionRef.current = latest.revision;
      setConflictDraft(null);
      const saved = await persistDraft(values, latest.revision);
      if (saved !== null) notify('Local changes saved against the latest revision.', 'success');
    } catch (error) {
      setSaveError(formatProblem(error));
      setSaveState('error');
    }
  };

  return (
    <AppShell>
      <PageHeader
        actions={
          <>
            <Link
              className="qf-button qf-button--quiet"
              href="/workflows"
              onClick={(event) => {
                if (!dirty) return;
                event.preventDefault();
                requestExit(() => router.push('/workflows'));
              }}
              prefetch={false}
            >
              <ArrowLeft size={16} />
              Catalog
            </Link>
            <SaveIndicator error={saveError} state={saveState} />
            {saveState === 'error' && editable ? (
              <Button
                disabled={!online}
                icon={<RefreshCw size={16} />}
                onClick={() => void persistDraft(values)}
                tone="secondary"
              >
                Retry save
              </Button>
            ) : null}
            {workflow?.versionStatus === 'draft' && can('configure_workflows') ? (
              <Button
                disabled={!online || saveState === 'conflict' || saveState === 'invalid'}
                icon={<Upload size={16} />}
                onClick={() => setActivateOpen(true)}
                tone="primary"
              >
                Activate version
              </Button>
            ) : null}
            {workflow?.versionStatus === 'active' && can('configure_workflows') ? (
              <Button
                disabled={!online}
                icon={<Copy size={16} />}
                loading={cloneMutation.isPending}
                onClick={() => cloneMutation.mutate()}
                tone="primary"
              >
                Clone new draft
              </Button>
            ) : null}
          </>
        }
        description="Draft changes autosave with compare-and-swap revisions. Activated content is read-only."
        eyebrow="Workflow version editor"
        title={workflow?.name ?? 'Workflow editor'}
      />

      {!search.ready ? (
        <StatePanel
          description="Reading the workflow identifier from this static route."
          kind="loading"
          title="Opening workflow"
        />
      ) : workflowId === null ? (
        <StatePanel
          action={
            <Link className="qf-button qf-button--secondary" href="/workflows" prefetch={false}>
              Choose a workflow
            </Link>
          }
          description="This static editor requires a valid UUID in the id query parameter."
          kind="empty"
          title="No workflow selected"
        />
      ) : (
        <PermissionSurface permission="read">
          <QueryState
            error={workflowQuery.error}
            isLoading={workflowQuery.isLoading}
            onRetry={() => void workflowQuery.refetch()}
          >
            {workflow !== undefined ? (
              <div className="qf-content-grid qf-content-grid--detail">
                <Panel
                  title="Version content"
                  description={
                    editable
                      ? `Draft revision ${String(workflow.revision)} · autosaves 850 ms after changes stop`
                      : 'This activated or retired version is immutable.'
                  }
                  actions={<StatusBadge status={workflow.versionStatus} />}
                >
                  {!online && editable ? (
                    <div className="qf-inline-alert" role="status">
                      <CloudOff size={18} />
                      <p>
                        Offline edits remain in this tab but are not saved. Reconnect before
                        leaving.
                      </p>
                    </div>
                  ) : null}
                  <form className="qf-form-stack" noValidate>
                    {errors.root?.draft?.message === undefined ? null : (
                      <div className="qf-form-error" role="alert">
                        {errors.root.draft.message}
                      </div>
                    )}
                    <WorkflowContentFields
                      editable={editable}
                      errors={errors}
                      register={register}
                    />
                  </form>
                </Panel>
                <div className="qf-content-grid">
                  <Panel title="Approval policy">
                    <WorkflowPolicyFields editable={editable} errors={errors} register={register} />
                  </Panel>
                  <Panel title="Version facts">
                    <dl className="qf-key-values">
                      <dt>Stable key</dt>
                      <dd className="qf-mono">{workflow.stableKey}</dd>
                      <dt>Version</dt>
                      <dd className="qf-mono">v{workflow.versionNo}</dd>
                      <dt>Revision</dt>
                      <dd className="qf-mono">r{workflow.revision}</dd>
                      <dt>Status</dt>
                      <dd>
                        <StatusBadge status={workflow.versionStatus} />
                      </dd>
                      <dt>Updated</dt>
                      <dd className="qf-mono">{new Date(workflow.updatedAt).toLocaleString()}</dd>
                    </dl>
                  </Panel>
                  {!can('configure_workflows') ? (
                    <StatePanel
                      description="Your role may inspect workflow configuration but cannot edit or activate versions."
                      kind="forbidden"
                      title="Read-only access"
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </QueryState>
        </PermissionSurface>
      )}

      <Dialog
        description="Activation retires the previous active version and makes this version content immutable."
        footer={
          <>
            <Button onClick={() => setActivateOpen(false)}>Keep as draft</Button>
            <Button
              disabled={!online}
              loading={activateMutation.isPending}
              loadingLabel="Activating"
              onClick={() => activateMutation.mutate()}
              tone="primary"
            >
              Activate immutable version
            </Button>
          </>
        }
        onClose={() => setActivateOpen(false)}
        open={activateOpen}
        title="Activate this workflow version?"
      >
        {activateMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(activateMutation.error)}
          </div>
        ) : null}
        <p>
          New requests will bind to this exact content. Existing requests remain bound to their
          original version.
        </p>
      </Dialog>

      <Dialog
        description="Another save changed the server revision after this editor loaded. Choose which content to keep."
        footer={
          <AutosaveConflictActions
            disabled={!online}
            onKeepLocal={() => void keepLocalCopy()}
            onLoadServer={() => void loadServerCopy()}
          />
        }
        onClose={() => {
          setConflictDraft(null);
          setSaveError('Revision conflict is unresolved. Edit again or reload the server copy.');
          setSaveState('error');
        }}
        open={conflictDraft !== null}
        title="Draft revision conflict"
      >
        <div className="qf-inline-alert">
          <AlertTriangle size={18} />
          <p>
            Loading the server copy discards unsaved local edits. Keeping local changes first
            fetches the newest revision, then submits an explicit compare-and-swap update.
          </p>
        </div>
      </Dialog>
    </AppShell>
  );
}
