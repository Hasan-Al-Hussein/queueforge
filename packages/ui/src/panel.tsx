import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from './cn.js';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  readonly actions?: ReactNode;
  readonly as?: 'section' | 'article' | 'div';
  readonly description?: string;
  readonly title?: string;
}

export function Panel({
  actions,
  as: Component = 'section',
  children,
  className,
  description,
  title,
  ...props
}: PanelProps): React.JSX.Element {
  return (
    <Component {...props} className={cn('qf-panel', className)}>
      {title !== undefined ? (
        <header className="qf-panel__header">
          <div>
            <h2 className="qf-panel__title">{title}</h2>
            {description !== undefined ? (
              <p className="qf-panel__description">{description}</p>
            ) : null}
          </div>
          {actions !== undefined ? <div className="qf-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="qf-panel__body">{children}</div>
    </Component>
  );
}
