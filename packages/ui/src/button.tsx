import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

import { cn } from './cn.js';

export type ButtonTone = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  readonly tone?: ButtonTone;
  readonly icon?: ReactNode;
}

export function Button({
  children,
  className,
  disabled = false,
  icon,
  loading = false,
  loadingLabel = 'Working',
  tone = 'secondary',
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element {
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      className={cn('qf-button', `qf-button--${tone}`, className)}
      disabled={isDisabled}
      type={type}
    >
      <span className="qf-button__icon" aria-hidden="true">
        {loading ? <LoaderCircle className="qf-spin" size={16} /> : icon}
      </span>
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
}
