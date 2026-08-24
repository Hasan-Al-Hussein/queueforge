import type { ReactNode } from 'react';
import { Ban, CloudOff, Inbox, LoaderCircle, ShieldAlert, TriangleAlert } from 'lucide-react';

import { cn } from './cn.js';

export type StateKind = 'loading' | 'empty' | 'error' | 'forbidden' | 'offline';

const ICONS: Readonly<Record<StateKind, ReactNode>> = {
  loading: <LoaderCircle className="qf-spin" size={22} />,
  empty: <Inbox size={22} />,
  error: <TriangleAlert size={22} />,
  forbidden: <ShieldAlert size={22} />,
  offline: <CloudOff size={22} />,
};

export interface StatePanelProps {
  readonly action?: ReactNode;
  readonly className?: string;
  readonly description: string;
  readonly kind: StateKind;
  readonly title: string;
}

export function StatePanel({
  action,
  className,
  description,
  kind,
  title,
}: StatePanelProps): React.JSX.Element {
  return (
    <section
      className={cn('qf-state', `qf-state--${kind}`, className)}
      aria-busy={kind === 'loading'}
    >
      <span className="qf-state__icon" aria-hidden="true">
        {kind === 'forbidden' ? <Ban size={22} /> : ICONS[kind]}
      </span>
      <div>
        <h2 className="qf-state__title">{title}</h2>
        <p>{description}</p>
      </div>
      {action !== undefined ? <div className="qf-state__action">{action}</div> : null}
    </section>
  );
}
