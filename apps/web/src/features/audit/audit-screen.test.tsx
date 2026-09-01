import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AuditEvent } from '../../domain/models';
import { ActivityList, AuditEventDetail } from './audit-screen';

const event: AuditEvent = {
  actorName: 'Amina Approver',
  correlationId: '00000000-0000-4000-8000-000000000002',
  eventType: 'approval.approved',
  id: '00000000-0000-4000-8000-000000000001',
  occurredAt: '2026-08-31T10:17:00.000Z',
  resourceId: '00000000-0000-4000-8000-000000000003',
  resourceType: 'approval_task',
  summary: '{"requestId":"00000000-0000-4000-8000-000000000004"}',
};

describe('activity log density and disclosure', () => {
  it('keeps the scan row concise and opens the selected event on demand', async () => {
    const onSelectEvent = vi.fn();
    const user = userEvent.setup();
    render(<ActivityList events={[event]} expanded onSelectEvent={onSelectEvent} />);

    expect(screen.getByText('Approval granted')).toBeVisible();
    expect(screen.getByText('approval')).toBeVisible();
    expect(screen.getByText('Amina Approver')).toBeVisible();
    expect(screen.queryByText('An approver accepted the request.')).not.toBeInTheDocument();
    expect(document.querySelector('time')).toHaveAttribute('datetime', event.occurredAt);

    await user.click(screen.getByRole('button', { name: 'View details for Approval granted' }));
    expect(onSelectEvent).toHaveBeenCalledWith(event);
  });

  it('renders ten useful records without embedding expanded technical payloads', () => {
    const events = Array.from({ length: 10 }, (_, index) => ({
      ...event,
      id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    }));

    render(<ActivityList events={events} expanded={false} onSelectEvent={vi.fn()} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.queryByText('Technical record')).not.toBeInTheDocument();
  });

  it('organizes event details into context and retained-evidence sections', () => {
    render(<AuditEventDetail event={event} />);

    expect(screen.getByRole('heading', { name: 'Record details' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Technical record' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Record details' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Technical record' })).toBeVisible();
    expect(screen.getByText('Amina Approver')).toBeVisible();
    expect(screen.getByText('approval.approved')).toBeVisible();
    expect(
      (screen.getByRole('textbox', { name: 'Technical record' }) as HTMLTextAreaElement).value,
    ).toContain('"requestId"');
  });
});
