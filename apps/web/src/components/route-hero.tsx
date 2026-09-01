'use client';

import type { ReactNode } from 'react';

import { cn } from '@queueforge/ui';

import styles from './route-hero.module.css';

export type HeroTone = 'danger' | 'role' | 'signal' | 'warning';
export type HeroVariant = 'compact' | 'feature';

export interface RouteHeroProps {
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly description: string;
  readonly eyebrow: string;
  readonly icon?: ReactNode;
  readonly meta?: ReactNode;
  readonly title: string;
  readonly tone?: HeroTone;
  readonly variant?: HeroVariant;
  readonly visual?: ReactNode;
}

export function RouteHero({
  actions,
  className,
  description,
  eyebrow,
  icon,
  meta,
  title,
  tone = 'role',
  variant = 'compact',
  visual,
}: RouteHeroProps): React.JSX.Element {
  return (
    <header
      className={cn(styles.hero, className)}
      data-has-actions={actions === undefined ? 'false' : 'true'}
      data-has-visual={visual === undefined ? 'false' : 'true'}
      data-tone={tone}
      data-variant={variant}
    >
      <div className={styles.registration} aria-hidden="true" />
      <div className={styles.lead}>
        <div className={styles.kicker}>
          {icon === undefined ? null : <span className={styles.icon}>{icon}</span>}
          <p className="qf-eyebrow">{eyebrow}</p>
        </div>
        <h1>{title}</h1>
        <p className={styles.description}>{description}</p>
        {meta === undefined ? null : <div className={styles.meta}>{meta}</div>}
      </div>
      {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
      {visual === undefined ? null : <div className={styles.visual}>{visual}</div>}
    </header>
  );
}

export interface HeroMetric {
  readonly label: string;
  readonly tone?: HeroTone;
  readonly value: ReactNode;
}

export function HeroMetrics({
  items,
}: {
  readonly items: readonly HeroMetric[];
}): React.JSX.Element {
  return (
    <dl className={styles.metrics}>
      {items.map((item) => (
        <div data-tone={item.tone ?? 'role'} key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface HeroRailItem {
  readonly description?: string;
  readonly label: string;
  readonly state: 'attention' | 'complete' | 'current' | 'upcoming';
}

export function HeroRail({
  ariaLabel,
  items,
}: {
  readonly ariaLabel: string;
  readonly items: readonly HeroRailItem[];
}): React.JSX.Element {
  return (
    <ol aria-label={ariaLabel} className={styles.rail}>
      {items.map((item, index) => (
        <li
          aria-current={item.state === 'current' ? 'step' : undefined}
          data-state={item.state}
          key={item.label}
        >
          <span className={styles.railIndex} aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div>
            <strong>{item.label}</strong>
            {item.description === undefined ? null : <small>{item.description}</small>}
          </div>
        </li>
      ))}
    </ol>
  );
}
