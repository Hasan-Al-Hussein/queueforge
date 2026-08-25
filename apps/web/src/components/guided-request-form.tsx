'use client';

import type { WorkflowField } from './workflow-schema';

interface GuidedRequestFormProps {
  readonly disabled?: boolean;
  readonly errors: Readonly<Record<string, string>>;
  readonly fields: readonly WorkflowField[];
  readonly onChange: (key: string, value: unknown) => void;
  readonly values: Readonly<Record<string, unknown>>;
}

function fieldId(key: string): string {
  return `request-field-${key.replaceAll(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function GuidedRequestForm({
  disabled = false,
  errors,
  fields,
  onChange,
  values,
}: GuidedRequestFormProps): React.JSX.Element {
  return (
    <div className="qf-guided-form">
      {fields.map((field) => {
        const id = fieldId(field.key);
        const error = errors[field.key];
        const message = error ?? field.description;
        const rawValue = values[field.key];
        if (field.kind === 'boolean') {
          return (
            <div
              className={error === undefined ? 'qf-field' : 'qf-field qf-field--error'}
              key={field.key}
            >
              <label className="qf-choice-card" htmlFor={id}>
                <input
                  aria-describedby={`${id}-message`}
                  checked={rawValue === true}
                  disabled={disabled}
                  id={id}
                  onChange={(event) => onChange(field.key, event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>
                  <strong>{field.label}</strong>
                  {field.required ? <span className="qf-required-copy">Required</span> : null}
                </span>
              </label>
              <p className="qf-field__message" id={`${id}-message`}>
                {message !== '' ? message : '\u00a0'}
              </p>
            </div>
          );
        }
        if (field.kind === 'choice') {
          return (
            <div
              className={error === undefined ? 'qf-field' : 'qf-field qf-field--error'}
              key={field.key}
            >
              <label className="qf-field__label" htmlFor={id}>
                {field.label}
                {field.required ? <span aria-hidden="true"> *</span> : null}
              </label>
              <select
                aria-describedby={`${id}-message`}
                aria-invalid={error !== undefined}
                className="qf-input"
                disabled={disabled}
                id={id}
                onChange={(event) => onChange(field.key, event.currentTarget.value)}
                required={field.required}
                value={typeof rawValue === 'string' ? rawValue : ''}
              >
                <option value="">Select an option</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <p className="qf-field__message" id={`${id}-message`}>
                {message !== '' ? message : '\u00a0'}
              </p>
            </div>
          );
        }
        const numeric = field.kind === 'number' || field.kind === 'integer';
        const inputType = numeric
          ? 'number'
          : field.kind === 'url'
            ? 'url'
            : field.kind === 'email' || field.kind === 'date'
              ? field.kind
              : 'text';
        const value = typeof rawValue === 'string' || typeof rawValue === 'number' ? rawValue : '';
        const common = {
          'aria-describedby': `${id}-message`,
          'aria-invalid': error !== undefined,
          className: 'qf-input',
          disabled,
          id,
          max: field.maximum,
          maxLength: field.maxLength,
          min: field.minimum,
          minLength: field.minLength,
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onChange(field.key, event.currentTarget.value),
          required: field.required,
          value,
        };
        return (
          <div
            className={error === undefined ? 'qf-field' : 'qf-field qf-field--error'}
            key={field.key}
          >
            <label className="qf-field__label" htmlFor={id}>
              {field.label}
              {field.required ? <span aria-hidden="true"> *</span> : null}
            </label>
            {field.kind === 'long_text' ? (
              <textarea {...common} className="qf-input qf-textarea qf-textarea--comfortable" />
            ) : (
              <input {...common} step={field.kind === 'integer' ? 1 : undefined} type={inputType} />
            )}
            <p
              aria-live={error === undefined ? 'off' : 'polite'}
              className="qf-field__message"
              id={`${id}-message`}
            >
              {message !== '' ? message : '\u00a0'}
            </p>
          </div>
        );
      })}
    </div>
  );
}
