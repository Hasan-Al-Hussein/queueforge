'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useForm,
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
} from 'react-hook-form';
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
import { WorkflowFieldBuilder } from '../../components/workflow-field-builder';
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
  readonly setValue: UseFormSetValue<EditorForm>;
  readonly values: EditorForm;
}

export function WorkflowContentFields({
  editable,
  errors,
  register,
  setValue,
  values,
}: WorkflowContentFieldsProps): React.JSX.Element {
  const processingConfig = (() => {
    try {
      const parsed = JSON.parse(values.processingConfigText) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // The advanced editor below owns malformed JSON recovery.
    }
    return {};
  })();
  const setProcessingValue = (key: string, value: number): void => {
    setValue(
      'processingConfigText',
      JSON.stringify(
        {
          durationMs: 250,
          failuresBeforeSuccess: 0,
          maxAttempts: 5,
          ...processingConfig,
          [key]: value,
        },
        null,
        2,
      ),
      { shouldDirty: true },
    );
  };
  const targets: readonly unknown[] = (() => {
    try {
      const parsed = JSON.parse(values.targetsText) as unknown;
      return Array.isArray(parsed) ? (parsed as unknown[]) : [];
    } catch {
      return [];
    }
  })();
  return (
    <>
      <section className="qf-editor-section">
        <div className="qf-editor-section__heading">
          <span>1</span>
          <div>
            <h3>Name and explain this request type</h3>
            <p>Use language that requesters and approvers will recognize immediately.</p>
          </div>
        </div>
        <div className="qf-form-grid qf-form-grid--two">
          <InputField
            disabled={!editable}
            error={errors.name?.message}
            id="editor-name"
            label="Request type name"
            maxLength={160}
            required
            {...register('name', { required: 'Name is required.' })}
          />
          <TextareaField
            className="qf-textarea--comfortable"
            disabled={!editable}
            error={errors.description?.message}
            id="editor-description"
            label="Short explanation"
            maxLength={2000}
            {...register('description')}
          />
        </div>
      </section>

      <section className="qf-editor-section" id="editor-request-schema" tabIndex={-1}>
        <div className="qf-editor-section__heading">
          <span>2</span>
          <div>
            <h3>Build the request form</h3>
            <p>These become normal labeled fields for the person starting a request.</p>
          </div>
        </div>
        <WorkflowFieldBuilder
          disabled={!editable}
          error={errors.requestSchemaText?.message}
          jsonText={values.requestSchemaText}
          onChange={(nextJson) => setValue('requestSchemaText', nextJson, { shouldDirty: true })}
        />
      </section>

      <section className="qf-editor-section">
        <div className="qf-editor-section__heading">
          <span>3</span>
          <div>
            <h3>Choose how processing behaves</h3>
            <p>Safe defaults work for most demonstrations. Change them only when needed.</p>
          </div>
        </div>
        <div className="qf-form-grid qf-form-grid--three">
          <InputField
            disabled={!editable}
            error={errors.processingConfigText?.message}
            helper="Usually 250 ms for the local demo."
            id="editor-processing-duration"
            label="Typical run time (ms)"
            max={10000}
            min={0}
            onChange={(event) =>
              setProcessingValue('durationMs', Number(event.currentTarget.value))
            }
            type="number"
            value={
              typeof processingConfig.durationMs === 'number' ? processingConfig.durationMs : 250
            }
          />
          <InputField
            disabled={!editable}
            helper="How many times QueueForge may try."
            id="editor-processing-attempts"
            label="Maximum attempts"
            max={25}
            min={1}
            onChange={(event) =>
              setProcessingValue('maxAttempts', Number(event.currentTarget.value))
            }
            type="number"
            value={
              typeof processingConfig.maxAttempts === 'number' ? processingConfig.maxAttempts : 5
            }
          />
          <InputField
            disabled={!editable}
            helper="Demo-only failure simulation; keep 0 normally."
            id="editor-processing-failures"
            label="Simulated failures"
            max={10}
            min={0}
            onChange={(event) =>
              setProcessingValue('failuresBeforeSuccess', Number(event.currentTarget.value))
            }
            type="number"
            value={
              typeof processingConfig.failuresBeforeSuccess === 'number'
                ? processingConfig.failuresBeforeSuccess
                : 0
            }
          />
        </div>
        <details className="qf-advanced-disclosure">
          <summary>Advanced processing JSON</summary>
          <TextareaField
            className="qf-json-editor"
            disabled={!editable}
            error={errors.processingConfigText?.message}
            helper="The visual controls above write this validated configuration."
            id="editor-processing-policy"
            label="Processing policy JSON"
            required
            spellCheck={false}
            {...register('processingConfigText')}
          />
        </details>
      </section>

      <section className="qf-editor-section">
        <div className="qf-editor-section__heading">
          <span>4</span>
          <div>
            <h3>Review what happens after approval</h3>
            <p>The processor runs first, followed by configured delivery or notification steps.</p>
          </div>
        </div>
        <div className="qf-execution-summary">
          {targets.map((target, index) => {
            const targetRecord =
              typeof target === 'object' && target !== null
                ? (target as Record<string, unknown>)
                : null;
            const kind =
              targetRecord !== null && 'targetKind' in targetRecord
                ? String(targetRecord.targetKind)
                : 'step';
            return (
              <div key={`${kind}-${String(index)}`}>
                <span>{String(index + 1)}</span>
                <div>
                  <strong>
                    {kind === 'processor'
                      ? 'Process request'
                      : kind === 'webhook'
                        ? 'Send webhook'
                        : kind === 'notification'
                          ? 'Notify people'
                          : 'Advanced step'}
                  </strong>
                  <p>
                    {kind === 'processor'
                      ? 'Processes the approved request.'
                      : kind === 'webhook'
                        ? 'Delivers a signed result to a configured endpoint.'
                        : kind === 'notification'
                          ? 'Creates an in-app notification.'
                          : 'Configured through the advanced editor.'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        <details className="qf-advanced-disclosure">
          <summary>Advanced delivery configuration</summary>
          <TextareaField
            className="qf-json-editor"
            disabled={!editable}
            error={errors.targetsText?.message}
            helper="Ordered processor, webhook, and notification targets. Reference endpoint IDs only; never paste secrets."
            id="editor-targets"
            label="Execution targets JSON"
            required
            spellCheck={false}
            {...register('targetsText')}
          />
        </details>
      </section>
    </>
  );
}

type WorkflowPolicyFieldsProps = Pick<
  WorkflowContentFieldsProps,
  'editable' | 'errors' | 'register'
>;

export function WorkflowPolicyFields({
  editable,
  errors,
  register,
}: WorkflowPolicyFieldsProps): React.JSX.Element {
  const policies = [
    {
      description: 'Paused request types remain visible but cannot accept new requests.',
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
        Changes need review
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
    setValue,
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
      notify(`Request type published as version ${String(workflow.versionNo)}.`, 'success');
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
      notify('Editable draft created from the published request type.', 'success');
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
      notify('Loaded the newest saved copy.', 'info');
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
      if (saved !== null) notify('Your changes were saved against the newest copy.', 'success');
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
              Request types
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
                Publish changes
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
                Create editable draft
              </Button>
            ) : null}
          </>
        }
        description="Draft changes save automatically. Published versions stay unchanged so existing requests keep their original rules."
        eyebrow="Request type setup"
        title={workflow?.name ?? 'Request type editor'}
      />

      {!search.ready ? (
        <StatePanel
          description="Reading the request type reference from this page."
          kind="loading"
          title="Opening request type"
        />
      ) : workflowId === null ? (
        <StatePanel
          action={
            <Link className="qf-button qf-button--secondary" href="/workflows" prefetch={false}>
              Choose a request type
            </Link>
          }
          description="Choose a request type from the catalog to edit its form and rules."
          kind="empty"
          title="No request type selected"
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
                  title="Request type setup"
                  description={
                    editable
                      ? 'Draft · changes save automatically after you stop typing'
                      : 'Published and archived versions are read-only. Create a draft to make changes.'
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
                      setValue={setValue}
                      values={values}
                    />
                  </form>
                </Panel>
                <div className="qf-content-grid">
                  <Panel title="Approval policy">
                    <WorkflowPolicyFields editable={editable} errors={errors} register={register} />
                  </Panel>
                  <Panel title="Published record">
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
                      description="Your role may review this request type but cannot edit or publish changes."
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
        description="Publishing makes this setup available to new requests. The previous published version stays unchanged for existing requests."
        footer={
          <>
            <Button onClick={() => setActivateOpen(false)}>Keep as draft</Button>
            <Button
              disabled={!online}
              loading={activateMutation.isPending}
              loadingLabel="Publishing"
              onClick={() => activateMutation.mutate()}
              tone="primary"
            >
              Publish request type
            </Button>
          </>
        }
        onClose={() => setActivateOpen(false)}
        open={activateOpen}
        title="Publish this request type?"
      >
        {activateMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(activateMutation.error)}
          </div>
        ) : null}
        <p>
          New requests will use this exact setup. Existing requests keep the version they started
          with.
        </p>
      </Dialog>

      <Dialog
        description="A newer saved copy exists. Choose whether to use it or keep the changes in this tab."
        footer={
          <AutosaveConflictActions
            disabled={!online}
            onKeepLocal={() => void keepLocalCopy()}
            onLoadServer={() => void loadServerCopy()}
          />
        }
        onClose={() => {
          setConflictDraft(null);
          setSaveError('Choose which copy to keep before continuing.');
          setSaveState('error');
        }}
        open={conflictDraft !== null}
        title="Someone else changed this draft"
      >
        <div className="qf-inline-alert">
          <AlertTriangle size={18} />
          <p>
            Using the saved copy discards changes that exist only in this tab. Keeping your changes
            combines them with the newest saved copy before saving again.
          </p>
          <details className="qf-advanced-disclosure">
            <summary>Technical behavior</summary>
            <p>
              QueueForge reloads the latest revision and uses a compare-and-swap update so one
              editor cannot silently overwrite another.
            </p>
          </details>
        </div>
      </Dialog>
    </AppShell>
  );
}
