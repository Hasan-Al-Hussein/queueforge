import type { ReactNode } from 'react';
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock3,
  LoaderCircle,
  PauseCircle,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

import { cn } from './cn.js';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATUS_TONES: Readonly<Record<string, StatusTone>> = {
  active: 'success',
  approved: 'success',
  healthy: 'success',
  delivered: 'success',
  published: 'success',
  succeeded: 'success',
  success: 'success',
  cancelled: 'neutral',
  draft: 'neutral',
  received: 'neutral',
  retired: 'neutral',
  processing: 'info',
  delivering: 'info',
  info: 'info',
  queued: 'info',
  pending: 'warning',
  warning: 'warning',
  pending_approval: 'warning',
  retry: 'warning',
  delayed: 'warning',
  dead: 'danger',
  dead_lettered: 'danger',
  failed: 'danger',
  error: 'danger',
  rejected: 'danger',
  validation_failed: 'danger',
  forbidden: 'danger',
};

function iconForStatus(status: string): ReactNode {
  const normalized = status.toLowerCase();
  if (
    ['active', 'approved', 'delivered', 'published', 'succeeded', 'healthy'].includes(normalized)
  ) {
    return <CheckCircle2 size={13} />;
  }
  if (['failed', 'rejected', 'validation_failed', 'dead', 'dead_lettered'].includes(normalized)) {
    return <XCircle size={13} />;
  }
  if (['pending', 'pending_approval', 'delayed'].includes(normalized)) {
    return <Clock3 size={13} />;
  }
  if (['delivering', 'processing'].includes(normalized)) {
    return <LoaderCircle className="qf-spin" size={13} />;
  }
  if (['retry'].includes(normalized)) {
    return <RotateCcw size={13} />;
  }
  if (['cancelled', 'retired'].includes(normalized)) {
    return <Ban size={13} />;
  }
  if (['forbidden'].includes(normalized)) {
    return <ShieldAlert size={13} />;
  }
  if (['draft'].includes(normalized)) {
    return <PauseCircle size={13} />;
  }
  return <CircleDashed size={13} />;
}

export interface StatusBadgeProps {
  readonly label?: string;
  readonly status: string;
  readonly tone?: StatusTone;
  readonly className?: string;
}

export function StatusBadge({
  className,
  label,
  status,
  tone,
}: StatusBadgeProps): React.JSX.Element {
  const normalized = status.toLowerCase();
  const resolvedTone = tone ?? STATUS_TONES[normalized] ?? 'neutral';
  const text = label ?? status.replaceAll('_', ' ');

  return (
    <span className={cn('qf-status', `qf-status--${resolvedTone}`, className)}>
      <span aria-hidden="true">{iconForStatus(normalized)}</span>
      <span>{text}</span>
    </span>
  );
}
