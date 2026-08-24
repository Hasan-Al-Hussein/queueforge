import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { describe, expect, it, vi } from 'vitest';

import { DataTable } from './data-table';

interface Row {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}
const columns: readonly ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'status', header: 'Status' },
];
const rows: readonly Row[] = [
  { id: '1', name: 'Zulu request', status: 'failed' },
  { id: '2', name: 'Alpha request', status: 'queued' },
];

describe('DataTable', () => {
  it('filters rows through a labeled search field', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        ariaLabel="Requests"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        search={{
          label: 'Search requests',
          placeholder: 'Search',
          text: (row) => `${row.name} ${row.status}`,
        }}
      />,
    );
    await user.type(screen.getByRole('searchbox', { name: 'Search requests' }), 'queued');
    expect(await screen.findByText('Alpha request')).toBeInTheDocument();
    expect(screen.queryByText('Zulu request')).not.toBeInTheDocument();
  });

  it('exposes sortable headers with aria-sort', async () => {
    const user = userEvent.setup();
    render(
      <DataTable ariaLabel="Requests" columns={columns} getRowId={(row) => row.id} rows={rows} />,
    );
    const name = screen.getByRole('button', { name: /Name/i });
    await user.click(name);
    expect(name.closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('announces an empty filtered result', async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        ariaLabel="Requests"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        search={{
          label: 'Search requests',
          placeholder: 'Search',
          text: (row) => `${row.name} ${row.status}`,
        }}
      />,
    );
    await user.type(screen.getByRole('searchbox', { name: 'Search requests' }), 'missing');
    expect(await screen.findByText('No records match the current filter.')).toBeVisible();
  });

  it('delegates controlled search and sorting without reshaping the server page', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const onSort = vi.fn();
    render(
      <DataTable
        ariaLabel="Requests"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        search={{
          label: 'Search requests',
          onChange: onSearch,
          placeholder: 'Search',
          totalRows: 42,
          value: 'queued',
        }}
        sorting={{ onChange: onSort, state: [{ desc: true, id: 'name' }] }}
      />,
    );

    expect(screen.getByText('Zulu request')).toBeInTheDocument();
    expect(screen.getByText('Alpha request')).toBeInTheDocument();
    expect(screen.getByText('Showing 2 of 42 matching rows')).toBeVisible();
    await user.type(screen.getByRole('searchbox', { name: 'Search requests' }), 'x');
    expect(onSearch).toHaveBeenCalledWith('queuedx');
    await user.click(screen.getByRole('button', { name: /Name/i }));
    expect(onSort).toHaveBeenCalled();
  });
});
