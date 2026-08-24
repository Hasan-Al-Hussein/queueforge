import type { ReactNode } from 'react';

export interface PageHeaderProps {
  readonly actions?: ReactNode;
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
}

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className="qf-page-header">
      <div>
        {eyebrow !== undefined ? <p className="qf-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p className="qf-page-header__description">{description}</p>
      </div>
      {actions !== undefined ? <div className="qf-page-header__actions">{actions}</div> : null}
    </header>
  );
}
