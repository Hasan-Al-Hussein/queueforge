import type { SVGProps } from 'react';

import { cn } from '@queueforge/ui';

interface BrandMarkProps extends SVGProps<SVGSVGElement> {
  readonly compact?: boolean;
}

/**
 * Three request rails enter an independent witness press. The stamped record
 * leaves as a sealed proof diamond, keeping the QueueForge lifecycle legible
 * without reducing the mark to a letterform or generic chain link.
 */
export function BrandMark({
  className,
  compact = false,
  ...props
}: BrandMarkProps): React.JSX.Element {
  return (
    <svg
      {...props}
      aria-hidden="true"
      className={cn('qf-brand-mark', compact && 'qf-brand-mark--compact', className)}
      fill="none"
      focusable="false"
      viewBox="0 0 48 48"
    >
      <path className="qf-brand-mark__frame" d="M4.5 7.75v5.5m0 8v5.5m0 8v5.5M21 11.5h8v25h-8" />
      <path className="qf-brand-mark__rail" d="M4.5 10.5h8.75L21 18.75" />
      <path className="qf-brand-mark__rail" d="M4.5 24H21" />
      <path className="qf-brand-mark__rail" d="M4.5 37.5h8.75L21 29.25" />
      <path className="qf-brand-mark__gate" d="M25 5.5v12m-3 0h6L25 21.5Z" />
      <path className="qf-brand-mark__out" d="m25 21.5 2.5 2.5-2.5 2.5-2.5-2.5Z" />
      <path className="qf-brand-mark__rail" d="M29 24h5" />
      <path className="qf-brand-mark__node" d="m40 17.75 6.25 6.25L40 30.25 33.75 24Z" />
      <path className="qf-brand-mark__frame" d="M38 21.75h4m-4 2.25h4m-3 2.25h2" />
    </svg>
  );
}
