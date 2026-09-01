'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { ScrollReveal } from '../../components/cinematic-motion';
import { PermissionSurface } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { RouteHero } from '../../components/route-hero';
import { WorkflowFieldBuilder } from '../../components/workflow-field-builder';
import { fieldKindLabel, readWorkflowSchema } from '../../components/workflow-schema';
import { WorkflowDetailSchema, type WorkflowDetail } from '../../domain/models';
import {
  useDirtyNavigation,
  useDirtyNavigationSource,
} from '../../providers/dirty-navigation-provider';
import { useStaticSearchParam } from '../../hooks/use-static-search-param';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';
import { AutosaveConflictActions } from './autosave-conflict-actions';
import styles from './workflow-editor-screen.module.css';

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
export type WorkflowSetupStep = 0 | 1 | 2 | 3 | 4;

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

const EDITOR_STEP_BY_FIELD: Readonly<
  Record<Exclude<DraftProblemField, 'root'>, WorkflowSetupStep>
> = {
  description: 0,
  isEnabled: 2,
  name: 0,
  preventSelfApproval: 2,
  processingConfigText: 3,
  requestSchemaText: 1,
  requiresApproval: 2,
  targetsText: 4,
};

export function draftProblemField(path: readonly PropertyKey[]): DraftProblemField {
  const root = path[0];
  return typeof root === 'string' ? (DRAFT_FIELD_BY_INPUT_PATH[root] ?? 'root') : 'root';
}

export function focusDraftProblemField(field: Exclude<DraftProblemField, 'root'>): void {
  document.getElementById(EDITOR_CONTROL_ID_BY_FIELD[field])?.focus();
}

export function workflowSetupStepForProblemField(
  field: Exclude<DraftProblemField, 'root'>,
): WorkflowSetupStep {
  return EDITOR_STEP_BY_FIELD[field];
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
  readonly activeMobileStep?: WorkflowSetupStep;
  readonly editable: boolean;
  readonly errors: FieldErrors<EditorForm>;
  readonly register: UseFormRegister<EditorForm>;
  readonly setValue: UseFormSetValue<EditorForm>;
  readonly values: EditorForm;
}

export function WorkflowContentFields({
  activeMobileStep = 0,
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
      <section
        aria-labelledby="editor-identity-title"
        className={`${styles.setupStep} qf-editor-section`}
        data-mobile-active={activeMobileStep === 0}
        id="editor-identity"
        tabIndex={-1}
      >
        <div className={`${styles.stepHeading} qf-editor-section__heading`}>
          <span>01</span>
          <div>
            <h3 id="editor-identity-title">Name and explain this request type</h3>
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

      <section
        aria-labelledby="editor-request-schema-title"
        className={`${styles.setupStep} qf-editor-section`}
        data-mobile-active={activeMobileStep === 1}
        id="editor-request-schema"
        tabIndex={-1}
      >
        <div className={`${styles.stepHeading} qf-editor-section__heading`}>
          <span>02</span>
          <div>
            <h3 id="editor-request-schema-title">Build the request form</h3>
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

      <section
        aria-labelledby="editor-decision-policy-title"
        className={`${styles.setupStep} qf-editor-section`}
        data-mobile-active={activeMobileStep === 2}
        id="editor-decision-policy"
        tabIndex={-1}
      >
        <div className={`${styles.stepHeading} qf-editor-section__heading`}>
          <span>03</span>
          <div>
            <h3 id="editor-decision-policy-title">Place the decision gate</h3>
            <p>Choose when work may enter the queue and who is allowed to approve it.</p>
          </div>
        </div>
        <WorkflowPolicyFields editable={editable} errors={errors} register={register} />
      </section>

      <section
        aria-labelledby="editor-processing-step-title"
        className={`${styles.setupStep} qf-editor-section`}
        data-mobile-active={activeMobileStep === 3}
        id="editor-processing-step"
        tabIndex={-1}
      >
        <div className={`${styles.stepHeading} qf-editor-section__heading`}>
          <span>04</span>
          <div>
            <h3 id="editor-processing-step-title">Choose how processing behaves</h3>
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
        <details
          className="qf-advanced-disclosure"
          open={errors.processingConfigText?.message === undefined ? undefined : true}
        >
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

      <section
        aria-labelledby="editor-delivery-path-title"
        className={`${styles.setupStep} qf-editor-section`}
        data-mobile-active={activeMobileStep === 4}
        id="editor-delivery-path"
        tabIndex={-1}
      >
        <div className={`${styles.stepHeading} qf-editor-section__heading`}>
          <span>05</span>
          <div>
            <h3 id="editor-delivery-path-title">Review what happens after approval</h3>
            <p>The processor runs first, followed by configured delivery or notification steps.</p>
          </div>
        </div>
        <div className="qf-execution-summary">
          {targets.length === 0 ? (
            <div className={styles.emptyExecutionPath}>
              <span aria-hidden="true">0</span>
              <div>
                <strong>No delivery steps configured</strong>
                <p>Open the advanced delivery configuration to add the first ordered step.</p>
              </div>
            </div>
          ) : null}
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
        <details
          className="qf-advanced-disclosure"
          open={errors.targetsText?.message === undefined ? undefined : true}
        >
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
    <div className={styles.policyGrid}>
      {policies.map((policy) => {
        const error = errors[policy.field]?.message;
        return (
          <div
            className={
              error === undefined
                ? `${styles.policyCard} qf-field`
                : `${styles.policyCard} qf-field qf-field--error`
            }
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
    </div>
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

const SETUP_STEPS = [
  {
    description: 'Name the request in language your team recognizes.',
    href: '#editor-identity',
    id: 'editor-identity',
    number: '01',
    shortTitle: 'Name',
    title: 'Identity',
  },
  {
    description: 'Build the questions requesters will answer.',
    href: '#editor-request-schema',
    id: 'editor-request-schema',
    number: '02',
    shortTitle: 'Form',
    title: 'Intake form',
  },
  {
    description: 'Set the approval and self-approval rules.',
    href: '#editor-decision-policy',
    id: 'editor-decision-policy',
    number: '03',
    shortTitle: 'Gate',
    title: 'Decision gate',
  },
  {
    description: 'Bound retries, timing, and failure simulation.',
    href: '#editor-processing-step',
    id: 'editor-processing-step',
    number: '04',
    shortTitle: 'Retry',
    title: 'Processing',
  },
  {
    description: 'Confirm each ordered effect after approval.',
    href: '#editor-delivery-path',
    id: 'editor-delivery-path',
    number: '05',
    shortTitle: 'Deliver',
    title: 'Delivery path',
  },
] as const;

function requestFieldsFromText(text: string): ReturnType<typeof readWorkflowSchema> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return readWorkflowSchema(parsed as Record<string, unknown>);
    }
  } catch {
    // The advanced schema editor presents the parse error beside the source control.
  }
  return { fields: [], reason: 'The request schema needs attention.', supported: false };
}

function targetsFromText(text: string): readonly Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (target): target is Record<string, unknown> =>
            typeof target === 'object' && target !== null && !Array.isArray(target),
        )
      : [];
  } catch {
    return [];
  }
}

export function workflowSetupCompletion(values: EditorForm): readonly boolean[] {
  const requestFields = requestFieldsFromText(values.requestSchemaText);
  const targetCount = targetsFromText(values.targetsText).length;
  let processingIsValid = false;
  try {
    const processingConfig = JSON.parse(values.processingConfigText) as unknown;
    processingIsValid =
      typeof processingConfig === 'object' &&
      processingConfig !== null &&
      !Array.isArray(processingConfig);
  } catch {
    processingIsValid = false;
  }
  return [
    values.name.trim() !== '',
    requestFields.supported && requestFields.fields.length > 0,
    true,
    processingIsValid,
    targetCount > 0,
  ];
}

function WorkflowTopology({
  activeStep,
  onSelectStep,
  values,
}: {
  readonly activeStep: WorkflowSetupStep;
  readonly onSelectStep: (step: WorkflowSetupStep) => void;
  readonly values: EditorForm;
}): React.JSX.Element {
  const requestFields = requestFieldsFromText(values.requestSchemaText);
  const targetCount = targetsFromText(values.targetsText).length;
  const completed = workflowSetupCompletion(values);
  return (
    <section className={styles.topology} aria-labelledby="workflow-topology-title">
      <header>
        <div>
          <p className="qf-eyebrow">Request path</p>
          <h2 id="workflow-topology-title">Configuration topology</h2>
        </div>
        <span>
          {requestFields.fields.length} form fields · {targetCount} delivery steps
        </span>
      </header>
      <ol>
        {SETUP_STEPS.map((step, index) => (
          <li
            data-state={
              activeStep === index ? 'current' : completed[index] === true ? 'complete' : 'open'
            }
            key={step.id}
          >
            <button onClick={() => onSelectStep(index as WorkflowSetupStep)} type="button">
              <span>{step.number}</span>
              <strong>{step.title}</strong>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RequesterPreview({ values }: { readonly values: EditorForm }): React.JSX.Element {
  const schema = requestFieldsFromText(values.requestSchemaText);
  return (
    <div className={styles.requesterPreview}>
      <div className={styles.previewTopline}>
        <span>Requester view</span>
        <StatusBadge
          status={values.isEnabled ? 'active' : 'retired'}
          label={values.isEnabled ? 'Available' : 'Paused'}
        />
      </div>
      <h3>{values.name.trim() === '' ? 'Untitled request type' : values.name}</h3>
      <p>
        {values.description.trim() === ''
          ? 'Add a short explanation for requesters.'
          : values.description}
      </p>
      {!schema.supported ? (
        <div className={styles.previewNotice}>
          Preview unavailable until the request schema is valid.
        </div>
      ) : schema.fields.length === 0 ? (
        <div className={styles.previewNotice}>Add the first question to preview the form.</div>
      ) : (
        <div className={styles.previewFields}>
          {schema.fields.slice(0, 4).map((field) => (
            <div key={field.key}>
              <label>
                {field.label}
                {field.required ? <span aria-hidden="true"> *</span> : null}
              </label>
              <div>{fieldKindLabel(field.kind)}</div>
            </div>
          ))}
          {schema.fields.length > 4 ? (
            <span className={styles.previewMore}>
              +{String(schema.fields.length - 4)} more fields
            </span>
          ) : null}
        </div>
      )}
      <div className={styles.previewRoute}>
        <span>{values.requiresApproval ? 'Approval required' : 'Automatic approval'}</span>
        <span>
          Up to{' '}
          {(() => {
            try {
              const config = JSON.parse(values.processingConfigText) as Record<string, unknown>;
              return typeof config.maxAttempts === 'number' ? String(config.maxAttempts) : '5';
            } catch {
              return 'N/A';
            }
          })()}{' '}
          attempts
        </span>
      </div>
    </div>
  );
}

function PublishedWorkflowSummary({ values }: { readonly values: EditorForm }): React.JSX.Element {
  const schema = requestFieldsFromText(values.requestSchemaText);
  const targets = targetsFromText(values.targetsText);
  return (
    <div className={styles.publishedSummary}>
      <section>
        <span>Requester experience</span>
        <h3>{values.name}</h3>
        <p>{values.description.trim() === '' ? 'No description provided.' : values.description}</p>
        <dl>
          <div>
            <dt>Form fields</dt>
            <dd>{String(schema.fields.length)}</dd>
          </div>
          <div>
            <dt>Availability</dt>
            <dd>{values.isEnabled ? 'Accepting requests' : 'Paused'}</dd>
          </div>
        </dl>
      </section>
      <section>
        <span>Decision and processing</span>
        <h3>{values.requiresApproval ? 'Human approval required' : 'Runs automatically'}</h3>
        <p>
          {values.preventSelfApproval
            ? 'Requesters cannot approve their own work.'
            : 'Self-approval is allowed by this version.'}
        </p>
        <dl>
          <div>
            <dt>Delivery steps</dt>
            <dd>{String(targets.length)}</dd>
          </div>
          <div>
            <dt>Version state</dt>
            <dd>Published and read-only</dd>
          </div>
        </dl>
      </section>
      <details className="qf-advanced-disclosure">
        <summary>Technical configuration</summary>
        <pre className="qf-code-block">
          {JSON.stringify(
            {
              processingConfig: JSON.parse(values.processingConfigText) as unknown,
              requestSchema: JSON.parse(values.requestSchemaText) as unknown,
              targets: JSON.parse(values.targetsText) as unknown,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}

export function SetupNavigation({
  activeStep,
  onSelectStep,
}: {
  readonly activeStep: WorkflowSetupStep;
  readonly onSelectStep: (step: WorkflowSetupStep) => void;
}): React.JSX.Element {
  return (
    <nav className={styles.setupNavigation} aria-label="Request type setup steps">
      <p className="qf-eyebrow">Inspector</p>
      <h2>Configure one stage at a time</h2>
      <ol>
        {SETUP_STEPS.map((step, index) => (
          <li key={step.href}>
            <a
              aria-current={activeStep === index ? 'step' : undefined}
              href={step.href}
              onClick={() => onSelectStep(index as WorkflowSetupStep)}
            >
              <span aria-hidden="true">{step.number}</span>
              <span>
                <strong>{step.title}</strong>
                <small>{step.description}</small>
              </span>
            </a>
          </li>
        ))}
      </ol>
      <p className={styles.publishHint}>
        Drafts save automatically. Publish when every stage is ready for new requests.
      </p>
    </nav>
  );
}

export function MobileStepNavigator({
  activeStep,
  completedSteps = [],
  onStepChange,
}: {
  readonly activeStep: WorkflowSetupStep;
  readonly completedSteps?: readonly boolean[];
  readonly onStepChange: (step: WorkflowSetupStep) => void;
}): React.JSX.Element {
  const step = SETUP_STEPS[activeStep];
  return (
    <nav className={styles.mobileStepNavigator} aria-label="Current request type setup step">
      <ol className={styles.mobileStepRail}>
        {SETUP_STEPS.map((railStep, index) => {
          const state =
            activeStep === index ? 'current' : completedSteps[index] === true ? 'complete' : 'open';
          return (
            <li data-state={state} key={railStep.id}>
              <button
                aria-controls={railStep.id}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={`Step ${String(index + 1)}: ${railStep.title}${state === 'complete' ? ', complete' : state === 'current' ? ', current' : ''}`}
                onClick={() => onStepChange(index as WorkflowSetupStep)}
                type="button"
              >
                <span aria-hidden="true">
                  {state === 'complete' ? <Check size={13} strokeWidth={2.5} /> : railStep.number}
                </span>
                <small aria-hidden="true">{railStep.shortTitle}</small>
              </button>
            </li>
          );
        })}
      </ol>
      <div className={styles.mobileStepStatus} aria-live="polite">
        <span>
          Step {String(activeStep + 1)} of {String(SETUP_STEPS.length)}
        </span>
        <strong>{step.title}</strong>
      </div>
      <div className={styles.mobileStepActions}>
        <Button
          aria-controls={SETUP_STEPS[Math.max(0, activeStep - 1)]?.id}
          disabled={activeStep === 0}
          onClick={() => onStepChange((activeStep - 1) as WorkflowSetupStep)}
        >
          Previous
        </Button>
        <Button
          aria-controls={SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, activeStep + 1)]?.id}
          disabled={activeStep === SETUP_STEPS.length - 1}
          onClick={() => onStepChange((activeStep + 1) as WorkflowSetupStep)}
          tone="secondary"
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

export function WorkflowEditorStageBody({
  activeStep,
  children,
  completedSteps,
  onStepChange,
}: {
  readonly activeStep: WorkflowSetupStep;
  readonly children: ReactNode;
  readonly completedSteps: readonly boolean[];
  readonly onStepChange: (step: WorkflowSetupStep) => void;
}): React.JSX.Element {
  return (
    <>
      <MobileStepNavigator
        activeStep={activeStep}
        completedSteps={completedSteps}
        onStepChange={onStepChange}
      />
      {children}
    </>
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
  const [activeMobileStep, setActiveMobileStep] = useState<WorkflowSetupStep>(0);
  const [pendingFocusField, setPendingFocusField] = useState<Exclude<
    DraftProblemField,
    'root'
  > | null>(null);
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
    if (pendingFocusField === null) return;
    focusDraftProblemField(pendingFocusField);
    document
      .getElementById(EDITOR_CONTROL_ID_BY_FIELD[pendingFocusField])
      ?.scrollIntoView({ block: 'center' });
    setPendingFocusField(null);
  }, [activeMobileStep, pendingFocusField]);

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
            setActiveMobileStep(workflowSetupStepForProblemField(problem.field));
            setError(problem.field, { message: problem.message });
            setPendingFocusField(problem.field);
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
  const activeSetupStep = SETUP_STEPS[activeMobileStep];
  const draftValidation = draftFromForm(values, workflow?.revision ?? revisionRef.current);
  const completedSetupSteps = workflowSetupCompletion(values);
  const selectSetupStep = useCallback((step: WorkflowSetupStep): void => {
    setActiveMobileStep(step);
    window.requestAnimationFrame(() => {
      document.getElementById(SETUP_STEPS[step].id)?.scrollIntoView({ block: 'start' });
    });
  }, []);

  return (
    <AppShell>
      <RouteHero
        className={styles.editorHero}
        description="Define the request form, approval gate, processing policy, and delivery path."
        eyebrow="Request type editor"
        icon={<Save size={18} />}
        meta="Five stages · autosaved · published versions stay unchanged"
        title={workflow?.name ?? 'Request type editor'}
        tone={['conflict', 'error', 'invalid'].includes(saveState) ? 'warning' : 'role'}
        visual={
          <div className={styles.editorHeroConsole}>
            <dl aria-label="Request type status" className={styles.editorHeroMetrics}>
              <div>
                <dt>Version</dt>
                <dd>{workflow === undefined ? 'N/A' : `v${String(workflow.versionNo)}`}</dd>
              </div>
              <div data-tone="signal">
                <dt>Status</dt>
                <dd>{workflow?.versionStatus ?? 'Loading'}</dd>
              </div>
              <div data-tone={values.requiresApproval ? 'warning' : 'signal'}>
                <dt>Decision</dt>
                <dd>{values.requiresApproval ? 'Human' : 'Automatic'}</dd>
              </div>
              <div>
                <dt>Builder step</dt>
                <dd>
                  {String(activeMobileStep + 1)} of {String(SETUP_STEPS.length)}
                </dd>
              </div>
            </dl>
            <div className={styles.editorHeroActions}>
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
              <div className={styles.editorSaveState}>
                <SaveIndicator error={saveError} state={saveState} />
              </div>
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
                  id="editor-publish-action"
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
            </div>
          </div>
        }
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
              <div className={styles.editorWorkspace}>
                <ScrollReveal amount={0.08}>
                  <WorkflowTopology
                    activeStep={activeMobileStep}
                    onSelectStep={selectSetupStep}
                    values={values}
                  />
                </ScrollReveal>
                <div className={styles.editorLayout}>
                  <aside className={styles.editorAside}>
                    <SetupNavigation activeStep={activeMobileStep} onSelectStep={selectSetupStep} />
                    {!can('configure_workflows') ? (
                      <StatePanel
                        description="Your role may review this request type but cannot edit or publish changes."
                        kind="forbidden"
                        title="Read-only access"
                      />
                    ) : null}
                  </aside>
                  <div className={styles.editorColumn}>
                    <Panel
                      className={styles.editorPanel}
                      title={`${activeSetupStep.number} · ${activeSetupStep.title}`}
                      description={
                        editable
                          ? activeSetupStep.description
                          : 'This published version is shown as a readable summary. Create a draft to change it.'
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
                      <WorkflowEditorStageBody
                        activeStep={activeMobileStep}
                        completedSteps={completedSetupSteps}
                        onStepChange={selectSetupStep}
                      >
                        {editable ? (
                          <ScrollReveal amount={0.08}>
                            <form className="qf-form-stack" noValidate>
                              {errors.root?.draft?.message === undefined ? null : (
                                <div className="qf-form-error" role="alert">
                                  {errors.root.draft.message}
                                </div>
                              )}
                              <WorkflowContentFields
                                activeMobileStep={activeMobileStep}
                                editable={editable}
                                errors={errors}
                                register={register}
                                setValue={setValue}
                                values={values}
                              />
                            </form>
                          </ScrollReveal>
                        ) : (
                          <ScrollReveal amount={0.08}>
                            <PublishedWorkflowSummary values={values} />
                          </ScrollReveal>
                        )}
                      </WorkflowEditorStageBody>
                    </Panel>
                  </div>
                  <aside
                    className={styles.evidenceAside}
                    aria-label="Preview and publication status"
                  >
                    <ScrollReveal amount={0.08}>
                      <Panel
                        className={styles.previewPanel}
                        title="Live requester preview"
                        description="A compact preview of what people will see when starting this request."
                      >
                        <RequesterPreview values={values} />
                      </Panel>
                    </ScrollReveal>
                    <ScrollReveal amount={0.08} delay={0.04}>
                      <Panel
                        className={styles.versionRecord}
                        id="editor-version-record"
                        title={editable ? 'Publish readiness' : 'Published record'}
                        description={
                          editable
                            ? 'Validation and version evidence for this draft.'
                            : 'The identifiers that keep this version traceable.'
                        }
                      >
                        <div
                          className={styles.readiness}
                          data-state={draftValidation.problem === undefined ? 'ready' : 'attention'}
                        >
                          {draftValidation.problem === undefined ? (
                            <Check aria-hidden="true" size={18} />
                          ) : (
                            <AlertTriangle aria-hidden="true" size={18} />
                          )}
                          <div>
                            <strong>
                              {draftValidation.problem === undefined
                                ? 'Configuration is valid'
                                : 'Configuration needs attention'}
                            </strong>
                            <p>
                              {draftValidation.problem?.message ??
                                (editable
                                  ? 'Ready to publish after the draft finishes saving.'
                                  : 'This published version passed validation.')}
                            </p>
                          </div>
                        </div>
                        <dl className={styles.versionGrid}>
                          <div>
                            <dt>Stable key</dt>
                            <dd className="qf-mono">{workflow.stableKey}</dd>
                          </div>
                          <div>
                            <dt>Version</dt>
                            <dd className="qf-mono">v{workflow.versionNo}</dd>
                          </div>
                          <div>
                            <dt>Revision</dt>
                            <dd className="qf-mono">r{workflow.revision}</dd>
                          </div>
                          <div>
                            <dt>Status</dt>
                            <dd>
                              <StatusBadge status={workflow.versionStatus} />
                            </dd>
                          </div>
                          <div>
                            <dt>Updated</dt>
                            <dd className="qf-mono">
                              {new Date(workflow.updatedAt).toLocaleString()}
                            </dd>
                          </div>
                        </dl>
                      </Panel>
                    </ScrollReveal>
                  </aside>
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
