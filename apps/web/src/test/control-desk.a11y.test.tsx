import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { Button, InputField, Panel, QueueRail, SelectField, StatusBadge } from '@queueforge/ui';

import { PaginationControls } from '../components/pagination-controls';

describe('Control desk accessibility', () => {
  it('has no detectable critical component violations', async () => {
    const { container } = render(
      <main>
        <h1>Request detail</h1>
        <Panel title="Lifecycle">
          <QueueRail
            items={[
              { id: 'one', label: 'Received', state: 'complete' },
              { id: 'two', label: 'Pending approval', state: 'current' },
            ]}
          />
        </Panel>
        <form aria-label="Request type form">
          <InputField
            helper="Stable external key."
            id="workflow-key-a11y"
            label="Request type key"
            required
          />
          <SelectField
            defaultValue="all"
            helper="Narrow the visible records."
            id="status-filter-a11y"
            label="Status"
          >
            <option value="all">All statuses</option>
            <option value="waiting">Waiting</option>
          </SelectField>
          <StatusBadge status="pending_approval" />
          <Button type="submit" tone="primary">
            Save draft
          </Button>
        </form>
        <PaginationControls
          ariaLabel="Requests"
          meta={{ page: 2, pageSize: 25, totalItems: 63, totalPages: 3 }}
          onPageChange={() => undefined}
          onPageSizeChange={() => undefined}
          page={2}
          pageSize={25}
        />
      </main>,
    );
    expect(screen.getByText(/Current stage/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveAttribute(
      'aria-describedby',
      'status-filter-a11y-message',
    );
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    });
    expect(results.violations).toEqual([]);
  });
});
