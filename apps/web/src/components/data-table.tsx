'use client';

/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- Wide operational tables require a keyboard-focusable scroll region. */

import { useDeferredValue, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table';

import { ArrowDown, ArrowUp, ChevronsUpDown, InputField, Search, cn } from '@queueforge/ui';

export interface DataTableProps<T> {
  readonly ariaLabel: string;
  readonly columns: readonly ColumnDef<T, unknown>[];
  readonly getRowId: (row: T) => string;
  readonly rows: readonly T[];
  readonly stickyLastColumn?: boolean;
  readonly search?: {
    readonly label: string;
    readonly maxLength?: number;
    readonly onChange?: (value: string) => void;
    readonly pending?: boolean;
    readonly placeholder: string;
    readonly text?: (row: T) => string;
    readonly totalRows?: number;
    readonly value?: string;
  };
  readonly sorting?: {
    readonly onChange: (state: SortingState) => void;
    readonly state: SortingState;
  };
}

export function DataTable<T>({
  ariaLabel,
  columns,
  getRowId,
  rows,
  search,
  stickyLastColumn = false,
  sorting: controlledSorting,
}: DataTableProps<T>): React.JSX.Element {
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const [localQuery, setLocalQuery] = useState('');
  const sorting = controlledSorting?.state ?? localSorting;
  const query = search?.value ?? localQuery;
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const filteredRows = useMemo(() => {
    const searchText = search?.text;
    if (
      search === undefined ||
      search.onChange !== undefined ||
      searchText === undefined ||
      deferredQuery.length === 0
    )
      return [...rows];
    return rows.filter((row) => searchText(row).toLowerCase().includes(deferredQuery));
  }, [deferredQuery, rows, search]);
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    if (controlledSorting === undefined) setLocalSorting(next);
    else controlledSorting.onChange(next);
  };
  // TanStack Table intentionally exposes mutable callback references; React Compiler skips this hook.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns: [...columns],
    data: filteredRows,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    getSortedRowModel: getSortedRowModel(),
    manualSorting: controlledSorting !== undefined,
    onSortingChange: handleSortingChange,
    state: { sorting },
  });

  return (
    <div className="qf-data-table">
      {search !== undefined ? (
        <div className="qf-data-table__search">
          <Search aria-hidden="true" size={17} />
          <InputField
            id={`${ariaLabel.toLowerCase().replaceAll(' ', '-')}-search`}
            label={search.label}
            maxLength={search.maxLength}
            onChange={(event) => {
              if (search.onChange === undefined) setLocalQuery(event.currentTarget.value);
              else search.onChange(event.currentTarget.value);
            }}
            placeholder={search.placeholder}
            type="search"
            value={query}
          />
          {search.pending === true ||
          (search.onChange === undefined && query.trim().toLowerCase() !== deferredQuery) ? (
            <span className="qf-utility">Searching…</span>
          ) : search.onChange !== undefined ? (
            <span className="qf-utility">All matching records</span>
          ) : (
            <span className="qf-utility">Current page only</span>
          )}
        </div>
      ) : null}
      <p className="qf-table-scroll-hint" aria-hidden="true">
        Swipe sideways to see more details →
      </p>
      <div
        className={cn('qf-table-scroll', stickyLastColumn && 'qf-table-scroll--sticky-last')}
        role="region"
        aria-label={`${ariaLabel} scroll area`}
        tabIndex={0}
      >
        <table aria-label={ariaLabel}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const ariaSort =
                    sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';
                  return (
                    <th
                      aria-sort={sorted === false ? undefined : ariaSort}
                      key={header.id}
                      scope="col"
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          className="qf-table-sort"
                          onClick={header.column.getToggleSortingHandler()}
                          type="button"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span aria-hidden="true">
                            {sorted === 'asc' ? (
                              <ArrowUp size={14} />
                            ) : sorted === 'desc' ? (
                              <ArrowDown size={14} />
                            ) : (
                              <ChevronsUpDown size={14} />
                            )}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td className="qf-table-empty" colSpan={table.getAllLeafColumns().length}>
                  No records match the current filter.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr className="qf-content-row" key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="qf-table-count qf-utility" aria-live="polite">
        {search?.totalRows === undefined
          ? `Showing ${String(filteredRows.length)} of ${String(rows.length)} rows on this page`
          : `Showing ${String(filteredRows.length)} of ${String(search.totalRows)} matching rows`}
      </p>
    </div>
  );
}
