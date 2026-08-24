'use client';

import { useCallback, useState } from 'react';

import { DEFAULT_PAGE_SIZE } from '@queueforge/contracts';

export interface PaginationState {
  readonly page: number;
  readonly pageSize: number;
}

export interface PaginationController extends PaginationState {
  readonly resetPage: () => void;
  readonly setPage: (page: number) => void;
  readonly setPageSize: (pageSize: number) => void;
}

export function usePagination(initialPageSize = DEFAULT_PAGE_SIZE): PaginationController {
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: initialPageSize,
  });

  const resetPage = useCallback((): void => {
    setPagination((current) => (current.page === 1 ? current : { ...current, page: 1 }));
  }, []);

  const setPage = useCallback((page: number): void => {
    setPagination((current) => ({ ...current, page: Math.max(1, Math.floor(page)) }));
  }, []);

  const setPageSize = useCallback((pageSize: number): void => {
    setPagination({ page: 1, pageSize });
  }, []);

  return { ...pagination, resetPage, setPage, setPageSize };
}

export function pageSearchParams({ page, pageSize }: PaginationState): URLSearchParams {
  return new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
}
