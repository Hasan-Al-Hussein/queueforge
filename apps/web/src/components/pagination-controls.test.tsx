import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { pageSearchParams, usePagination } from '../hooks/use-pagination';
import { PaginationControls } from './pagination-controls';

const meta = { page: 2, pageSize: 25, totalItems: 63, totalPages: 3 } as const;

describe('PaginationControls', () => {
  it('announces the server total and changes pages with native buttons', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <PaginationControls
        ariaLabel="Requests"
        meta={meta}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
        page={2}
        pageSize={25}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Requests pagination' })).toBeInTheDocument();
    expect(screen.getByText('26–50 of 63 records')).toBeVisible();
    expect(screen.getByText('Page 2 of 3')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Previous requests page' }));
    await user.click(screen.getByRole('button', { name: 'Next requests page' }));
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
  });

  it('offers bounded page sizes and disables navigation while loading', async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(
      <PaginationControls
        ariaLabel="Audit events"
        disabled
        meta={meta}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
        page={2}
        pageSize={25}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Audit events pagination' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByText('Loading page 2…')).toBeVisible();
    expect(screen.getByRole('button', { name: /previous audit events page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next audit events page/i })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Audit events rows per page' })).toBeDisabled();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Audit events rows per page' }),
      '50',
    );
    expect(onPageSizeChange).not.toHaveBeenCalled();
  });

  it('resets to page one when the page size changes', () => {
    const { result } = renderHook(() => usePagination());

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    act(() => result.current.setPageSize(50));
    expect(result.current).toMatchObject({ page: 1, pageSize: 50 });
    expect(pageSearchParams(result.current).toString()).toBe('page=1&pageSize=50');
  });
});
