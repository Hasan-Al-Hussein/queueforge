import type { ReactNode } from 'react';

export interface Metric {
  readonly detail?: string;
  readonly label: string;
  readonly value: ReactNode;
}

export function MetricStrip({ items }: { readonly items: readonly Metric[] }): React.JSX.Element {
  return (
    <dl className="qf-metric-strip">
      {items.map((item) => (
        <div className="qf-metric" key={item.label}>
          <dt>{item.label}</dt>
          <dd className="qf-mono">{item.value}</dd>
          {item.detail !== undefined ? <dd className="qf-metric__detail">{item.detail}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
