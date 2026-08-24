'use client';

import type { PageMeta } from '@queueforge/contracts';
import { ArrowLeft, ArrowRight, Button } from '@queueforge/ui';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PaginationControlsProps {
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly meta: PageMeta;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  readonly page: number;
  readonly pageSize: number;
}

function visibleRange(meta: PageMeta): string {
  if (meta.totalItems === 0) return '0 records';
  const first = (meta.page - 1) * meta.pageSize + 1;
  const last = Math.min(meta.page * meta.pageSize, meta.totalItems);
  return `${String(first)}–${String(last)} of ${String(meta.totalItems)} records`;
}

export function PaginationControls({
  ariaLabel,
  disabled = false,
  meta,
  onPageChange,
  onPageSizeChange,
  page,
  pageSize,
}: PaginationControlsProps): React.JSX.Element {
  const pageCount = Math.max(1, meta.totalPages);
  const previousDisabled = disabled || page <= 1;
  const nextDisabled = disabled || meta.totalPages === 0 || page >= meta.totalPages;

  return (
    <nav aria-busy={disabled} aria-label={`${ariaLabel} pagination`} className="qf-pagination">
      <p className="qf-pagination__range qf-utility" aria-live="polite">
        {visibleRange(meta)}
      </p>
      <div className="qf-pagination__controls">
        <label className="qf-pagination__page-size">
          Rows per page
          <select
            aria-label={`${ariaLabel} rows per page`}
            disabled={disabled}
            onChange={(event) => onPageSizeChange(Number(event.currentTarget.value))}
            value={pageSize}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <Button
          aria-label={`Previous ${ariaLabel.toLowerCase()} page`}
          disabled={previousDisabled}
          icon={<ArrowLeft size={16} />}
          onClick={() => onPageChange(page - 1)}
          tone="quiet"
        >
          Previous
        </Button>
        <span className="qf-pagination__status" aria-live="polite">
          {disabled
            ? `Loading page ${String(page)}…`
            : `Page ${String(page)} of ${String(pageCount)}`}
        </span>
        <Button
          aria-label={`Next ${ariaLabel.toLowerCase()} page`}
          disabled={nextDisabled}
          icon={<ArrowRight size={16} />}
          onClick={() => onPageChange(page + 1)}
          tone="quiet"
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
