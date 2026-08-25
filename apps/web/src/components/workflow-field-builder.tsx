'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Button, Plus, TextareaField, X } from '@queueforge/ui';

import {
  fieldKindLabel,
  nextWorkflowFieldKey,
  normalizeWorkflowFieldKey,
  readWorkflowSchema,
  writeWorkflowSchema,
  workflowFieldLabel,
  type WorkflowField,
  type WorkflowFieldKind,
} from './workflow-schema';

const FIELD_KINDS: readonly WorkflowFieldKind[] = [
  'short_text',
  'long_text',
  'number',
  'integer',
  'boolean',
  'choice',
  'email',
  'url',
  'date',
];

interface WorkflowFieldBuilderProps {
  readonly disabled: boolean;
  readonly error?: string;
  readonly jsonText: string;
  readonly onChange: (nextJson: string) => void;
}

function safeSchema(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function uniqueKey(value: string, index: number, fields: readonly WorkflowField[]): string {
  const candidate = normalizeWorkflowFieldKey(value);
  const normalized = candidate !== '' ? candidate : `field_${String(index + 1)}`;
  const used = new Set(
    fields.filter((_, fieldIndex) => fieldIndex !== index).map((field) => field.key),
  );
  if (!used.has(normalized)) return normalized;
  let suffix = 2;
  while (used.has(`${normalized}_${String(suffix)}`)) suffix += 1;
  return `${normalized}_${String(suffix)}`;
}

export function WorkflowFieldBuilder({
  disabled,
  error,
  jsonText,
  onChange,
}: WorkflowFieldBuilderProps): React.JSX.Element {
  const schema = useMemo(() => safeSchema(jsonText), [jsonText]);
  const parsed = useMemo(
    () =>
      schema === null
        ? {
            fields: [],
            reason: 'Fix the JSON syntax before returning to the visual builder.',
            supported: false,
          }
        : readWorkflowSchema(schema),
    [schema],
  );
  const [mode, setMode] = useState<'guided' | 'advanced'>('guided');

  const commit = (fields: readonly WorkflowField[]): void => {
    onChange(JSON.stringify(writeWorkflowSchema(fields), null, 2));
  };
  const update = (index: number, changes: Partial<WorkflowField>): void => {
    commit(
      parsed.fields.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...changes } : field,
      ),
    );
  };
  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= parsed.fields.length) return;
    const fields = [...parsed.fields];
    const current = fields[index];
    const other = fields[target];
    if (current === undefined || other === undefined) return;
    fields[index] = other;
    fields[target] = current;
    commit(fields);
  };

  return (
    <div className="qf-builder">
      <div className="qf-segmented" aria-label="Request form editing mode" role="group">
        <button aria-pressed={mode === 'guided'} onClick={() => setMode('guided')} type="button">
          Visual builder
        </button>
        <button
          aria-pressed={mode === 'advanced'}
          onClick={() => setMode('advanced')}
          type="button"
        >
          Advanced JSON
        </button>
      </div>
      {mode === 'advanced' ? (
        <TextareaField
          className="qf-json-editor"
          disabled={disabled}
          error={error}
          helper="For advanced JSON Schema rules. Everyday request forms are generated from this schema."
          id="editor-request-schema-json"
          label="Request schema"
          onChange={(event) => onChange(event.currentTarget.value)}
          required
          spellCheck={false}
          value={jsonText}
        />
      ) : !parsed.supported ? (
        <div className="qf-builder__unsupported" role="status">
          <strong>This workflow needs advanced editing</strong>
          <p>{parsed.reason}</p>
          <Button onClick={() => setMode('advanced')} tone="secondary">
            Open Advanced JSON
          </Button>
        </div>
      ) : (
        <>
          <div className="qf-builder__intro">
            <div>
              <h3>What should the requester fill in?</h3>
              <p>
                Add plain-language fields. QueueForge builds and validates the JSON Schema for you.
              </p>
            </div>
            <Button
              disabled={disabled}
              icon={<Plus size={16} />}
              onClick={() => {
                const key = nextWorkflowFieldKey(parsed.fields);
                commit([
                  ...parsed.fields,
                  {
                    description: '',
                    key,
                    kind: 'short_text',
                    label: workflowFieldLabel(key),
                    options: [],
                    required: true,
                  },
                ]);
              }}
              tone="secondary"
            >
              Add field
            </Button>
          </div>
          {parsed.fields.length === 0 ? (
            <div className="qf-builder__empty">
              <p>No fields yet. Add the first question that a requester should answer.</p>
            </div>
          ) : (
            <div className="qf-builder__fields">
              {parsed.fields.map((field, index) => (
                <article className="qf-builder-field" key={`workflow-field-${String(index)}`}>
                  <div className="qf-builder-field__topline">
                    <span className="qf-builder-field__number">{String(index + 1)}</span>
                    <strong>{field.label}</strong>
                    <div className="qf-row-actions">
                      <Button
                        aria-label={`Move ${field.label} up`}
                        disabled={disabled || index === 0}
                        icon={<ArrowUp size={15} />}
                        onClick={() => move(index, -1)}
                        tone="quiet"
                      />
                      <Button
                        aria-label={`Move ${field.label} down`}
                        disabled={disabled || index === parsed.fields.length - 1}
                        icon={<ArrowDown size={15} />}
                        onClick={() => move(index, 1)}
                        tone="quiet"
                      />
                      <Button
                        aria-label={`Remove ${field.label}`}
                        disabled={disabled}
                        icon={<X size={15} />}
                        onClick={() =>
                          commit(parsed.fields.filter((_, fieldIndex) => fieldIndex !== index))
                        }
                        tone="quiet"
                      />
                    </div>
                  </div>
                  <div className="qf-builder-field__grid">
                    <label>
                      <span>Question label</span>
                      <input
                        className="qf-input"
                        disabled={disabled}
                        maxLength={120}
                        onBlur={(event) => {
                          const normalized = event.currentTarget.value.trim();
                          update(index, {
                            label: normalized === '' ? workflowFieldLabel(field.key) : normalized,
                          });
                        }}
                        onChange={(event) => update(index, { label: event.currentTarget.value })}
                        value={field.label}
                      />
                    </label>
                    <label>
                      <span>Answer type</span>
                      <select
                        className="qf-input"
                        disabled={disabled}
                        onChange={(event) =>
                          update(index, {
                            kind: event.currentTarget.value as WorkflowFieldKind,
                            options: event.currentTarget.value === 'choice' ? field.options : [],
                          })
                        }
                        value={field.kind}
                      >
                        {FIELD_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {fieldKindLabel(kind)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="qf-builder-field__wide">
                      <span>Help text</span>
                      <input
                        className="qf-input"
                        disabled={disabled}
                        maxLength={300}
                        onChange={(event) =>
                          update(index, { description: event.currentTarget.value })
                        }
                        placeholder="Explain what a good answer looks like"
                        value={field.description}
                      />
                    </label>
                    {field.kind === 'choice' ? (
                      <label className="qf-builder-field__wide">
                        <span>Choices (one per line)</span>
                        <textarea
                          className="qf-input qf-textarea qf-textarea--compact"
                          disabled={disabled}
                          onChange={(event) =>
                            update(index, {
                              options: event.currentTarget.value
                                .split('\n')
                                .map((option) => option.trim())
                                .filter(Boolean),
                            })
                          }
                          value={field.options.join('\n')}
                        />
                      </label>
                    ) : null}
                    <label>
                      <span>Internal field key</span>
                      <input
                        className="qf-input qf-mono"
                        disabled={disabled}
                        onBlur={(event) =>
                          update(index, {
                            key: uniqueKey(event.currentTarget.value, index, parsed.fields),
                          })
                        }
                        onChange={(event) => update(index, { key: event.currentTarget.value })}
                        value={field.key}
                      />
                    </label>
                    <div className="qf-checkbox qf-checkbox--compact">
                      <input
                        checked={field.required}
                        disabled={disabled}
                        id={`builder-required-${String(index)}`}
                        onChange={(event) =>
                          update(index, { required: event.currentTarget.checked })
                        }
                        type="checkbox"
                      />
                      <label htmlFor={`builder-required-${String(index)}`}>
                        <strong>Required answer</strong>
                      </label>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {error === undefined ? null : (
            <p className="qf-form-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
