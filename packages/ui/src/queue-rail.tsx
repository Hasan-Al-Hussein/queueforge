import { Check, Circle, CircleAlert, Clock3 } from 'lucide-react';

import { cn } from './cn.js';

export type RailState = 'complete' | 'current' | 'pending' | 'failed';

export interface QueueRailItem {
  readonly description?: string;
  readonly id: string;
  readonly label: string;
  readonly state: RailState;
  readonly timestamp?: string;
}

function RailIcon({ state }: { readonly state: RailState }): React.JSX.Element {
  if (state === 'complete') return <Check size={12} strokeWidth={3} />;
  if (state === 'failed') return <CircleAlert size={12} strokeWidth={2.5} />;
  if (state === 'current') return <Clock3 size={12} strokeWidth={2.5} />;
  return <Circle size={9} strokeWidth={2} />;
}

export interface QueueRailProps {
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly items: readonly QueueRailItem[];
}

export function QueueRail({
  ariaLabel = 'Request lifecycle',
  className,
  items,
}: QueueRailProps): React.JSX.Element {
  return (
    <ol className={cn('qf-queue-rail', className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <li
          className={cn('qf-queue-rail__item', `qf-queue-rail__item--${item.state}`)}
          key={item.id}
        >
          <span className="qf-queue-rail__node" aria-hidden="true">
            <RailIcon state={item.state} />
          </span>
          <div className="qf-queue-rail__content">
            <div className="qf-queue-rail__line">
              <span className="qf-queue-rail__label">{item.label}</span>
              {item.timestamp !== undefined ? (
                <time className="qf-mono">{item.timestamp}</time>
              ) : null}
            </div>
            {item.description !== undefined ? <p>{item.description}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
