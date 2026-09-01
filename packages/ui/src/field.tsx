import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from './cn.js';
import { ChevronDown } from './icons.js';

interface FieldFrameProps {
  readonly children: React.ReactNode;
  readonly error?: string;
  readonly helper?: string;
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
}

function FieldFrame({
  children,
  error,
  helper,
  id,
  label,
  required = false,
}: FieldFrameProps): React.JSX.Element {
  const description = error ?? helper;
  return (
    <div className={cn('qf-field', error !== undefined && 'qf-field--error')}>
      <label className="qf-field__label" htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      <p
        className="qf-field__message"
        id={`${id}-message`}
        aria-live={error === undefined ? 'off' : 'polite'}
      >
        {description ?? '\u00a0'}
      </p>
    </div>
  );
}

export interface InputFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly error?: string;
  readonly helper?: string;
  readonly id: string;
  readonly label: string;
}

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(function InputField(
  { className, error, helper, id, label, required, ...props },
  ref,
): React.JSX.Element {
  return (
    <FieldFrame error={error} helper={helper} id={id} label={label} required={required}>
      <input
        {...props}
        aria-describedby={`${id}-message`}
        aria-invalid={error !== undefined}
        className={cn('qf-input', className)}
        id={id}
        ref={ref}
        required={required}
      />
    </FieldFrame>
  );
});

export type SelectControlProps = SelectHTMLAttributes<HTMLSelectElement>;

export const SelectControl = forwardRef<HTMLSelectElement, SelectControlProps>(
  function SelectControl({ children, className, ...props }, ref): React.JSX.Element {
    return (
      <span className="qf-select-control">
        <select {...props} className={cn('qf-select', className)} ref={ref}>
          {children}
        </select>
        <span aria-hidden="true" className="qf-select-control__indicator">
          <ChevronDown size={17} strokeWidth={2.1} />
        </span>
      </span>
    );
  },
);

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  readonly error?: string;
  readonly helper?: string;
  readonly id: string;
  readonly label: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { className, error, helper, id, label, required, ...props },
  ref,
): React.JSX.Element {
  return (
    <FieldFrame error={error} helper={helper} id={id} label={label} required={required}>
      <SelectControl
        {...props}
        aria-describedby={`${id}-message`}
        aria-invalid={error !== undefined}
        className={className}
        id={id}
        ref={ref}
        required={required}
      />
    </FieldFrame>
  );
});

export interface TextareaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id'
> {
  readonly error?: string;
  readonly helper?: string;
  readonly id: string;
  readonly label: string;
}

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  function TextareaField(
    { className, error, helper, id, label, required, ...props },
    ref,
  ): React.JSX.Element {
    return (
      <FieldFrame error={error} helper={helper} id={id} label={label} required={required}>
        <textarea
          {...props}
          aria-describedby={`${id}-message`}
          aria-invalid={error !== undefined}
          className={cn('qf-input qf-textarea', className)}
          id={id}
          ref={ref}
          required={required}
        />
      </FieldFrame>
    );
  },
);
