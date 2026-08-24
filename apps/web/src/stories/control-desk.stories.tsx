import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import {
  AlertTriangle,
  Button,
  Dialog,
  InputField,
  Panel,
  Plus,
  QueueRail,
  StatePanel,
  StatusBadge,
} from '@queueforge/ui';

const meta = {
  component: Panel,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  title: 'QueueForge/Control desk states',
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OperationalPanel: Story = {
  args: {
    actions: (
      <Button icon={<Plus size={16} />} tone="primary">
        Submit request
      </Button>
    ),
    children: (
      <QueueRail
        items={[
          { id: '1', label: 'received', state: 'complete', timestamp: '10:42:11' },
          {
            id: '2',
            label: 'pending approval',
            description: 'Decision required from an approver.',
            state: 'current',
            timestamp: '10:42:12',
          },
          { id: '3', label: 'queued', state: 'pending' },
        ]}
      />
    ),
    description: 'A lifecycle uses the signature queue rail.',
    title: 'Request QF-2048',
  },
};

export const StatusVocabulary: Story = {
  args: {
    children: (
      <div className="qf-row-actions">
        <StatusBadge status="succeeded" />
        <StatusBadge status="pending_approval" />
        <StatusBadge status="processing" />
        <StatusBadge status="dead_lettered" />
      </div>
    ),
    title: 'Semantic states',
  },
};

export const EmptyState: Story = {
  args: {
    children: (
      <StatePanel
        action={<Button>Configure workflow</Button>}
        description="Activate a workflow to accept the first request."
        kind="empty"
        title="No workflow activity yet"
      />
    ),
    title: 'Empty',
  },
};

export const ErrorState: Story = {
  args: {
    children: (
      <StatePanel
        action={<Button>Try again</Button>}
        description="The local API did not answer. Check port 3001 and retry."
        kind="offline"
        title="API unavailable"
      />
    ),
    title: 'Network failure',
  },
};

export const FormState: Story = {
  args: {
    children: (
      <div className="qf-form-stack">
        <InputField
          id="story-name"
          label="Workflow name"
          required
          value="Expense review"
          readOnly
        />
        <InputField
          error="Use a lowercase stable key."
          id="story-key"
          label="Stable key"
          value="Expense Review"
          readOnly
        />
        <Button tone="primary">Save draft</Button>
      </div>
    ),
    title: 'Validation feedback',
  },
};

export const RevisionConflict: Story = {
  args: {
    children: (
      <div className="qf-inline-alert">
        <AlertTriangle size={18} />
        <p>
          Another save changed revision 7. Choose the server copy or explicitly keep local edits.
        </p>
      </div>
    ),
    title: 'Revision conflict',
  },
};

export const ConfirmationDialog: Story = {
  args: {
    children: <p>Open the canvas controls to toggle this controlled dialog example.</p>,
    title: 'Dialog reference',
  },
  render: () => (
    <Dialog
      description="Attempt history remains append-only."
      footer={
        <>
          <Button>Cancel</Button>
          <Button tone="primary">Confirm retry</Button>
        </>
      }
      onClose={() => undefined}
      open
      title="Retry this request?"
    >
      <p>The request will return to the durable queue.</p>
    </Dialog>
  ),
};

export const RequestTable: Story = {
  args: {
    children: (
      <div className="qf-table-scroll" role="region" aria-label="Recent requests table">
        <table aria-label="Recent workflow requests">
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col">Workflow</th>
              <th scope="col">State</th>
              <th scope="col">Source</th>
              <th scope="col">Received</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>8f0b…43a2</code>
              </td>
              <td>Expense review</td>
              <td>
                <StatusBadge status="pending_approval" />
              </td>
              <td>API</td>
              <td>
                <time dateTime="2026-08-24T12:42:11Z">24 Aug, 16:42</time>
              </td>
            </tr>
            <tr>
              <td>
                <code>2be1…e19c</code>
              </td>
              <td>Vendor intake</td>
              <td>
                <StatusBadge status="succeeded" />
              </td>
              <td>Webhook</td>
              <td>
                <time dateTime="2026-08-24T12:39:04Z">24 Aug, 16:39</time>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
    description: 'Dense, sortable production tables retain semantic headers and exact states.',
    title: 'Recent requests',
  },
};

export const AuditTimeline: Story = {
  args: {
    children: (
      <QueueRail
        ariaLabel="Audit history for request 8f0b"
        items={[
          {
            description: 'Amina Rahman submitted the request from the API.',
            id: 'audit-1',
            label: 'request.created',
            state: 'complete',
            timestamp: '16:42:11',
          },
          {
            description: 'Policy engine created approval task revision 1.',
            id: 'audit-2',
            label: 'approval.requested',
            state: 'complete',
            timestamp: '16:42:12',
          },
          {
            description: 'Awaiting a decision from the tenant approver role.',
            id: 'audit-3',
            label: 'approval.pending',
            state: 'current',
            timestamp: '16:42:12',
          },
        ]}
      />
    ),
    description: 'Append-only events preserve actor, action, and request lifecycle order.',
    title: 'Audit timeline',
  },
};

export const ApprovalCard: Story = {
  args: {
    children: (
      <article aria-labelledby="approval-card-title">
        <div className="qf-notification__title">
          <h3 id="approval-card-title">Expense review · AED 18,750</h3>
          <StatusBadge status="pending" label="decision required" />
        </div>
        <dl className="qf-role-list">
          <div>
            <dt>Requested by</dt>
            <dd>Amina Rahman · Operations</dd>
          </div>
          <div>
            <dt>Policy evidence</dt>
            <dd>Version 12 · payload hash 91f2…b704 · approval revision 1</dd>
          </div>
        </dl>
        <div className="qf-row-actions" aria-label="Approval actions">
          <Button tone="primary">Approve</Button>
          <Button tone="danger">Reject</Button>
        </div>
      </article>
    ),
    description: 'A decision always exposes the requester and immutable policy evidence.',
    title: 'Approval task',
  },
};

export const WebhookDeliveryPanel: Story = {
  args: {
    actions: <Button>Replay delivery</Button>,
    children: (
      <dl className="qf-role-list">
        <div>
          <dt>Lifecycle</dt>
          <dd>
            <StatusBadge status="retry" label="retry scheduled" />
          </dd>
        </div>
        <div>
          <dt>Endpoint</dt>
          <dd>Local audit sink · event request.approved</dd>
        </div>
        <div>
          <dt>Latest attempt</dt>
          <dd>
            HTTP <span className="qf-mono">503</span> · attempt 3 of 6
          </dd>
        </div>
        <div>
          <dt>Next attempt</dt>
          <dd>
            <time dateTime="2026-08-24T12:47:30Z">24 Aug 2026, 16:47:30</time>
          </dd>
        </div>
      </dl>
    ),
    description: 'At-least-once delivery state with exact attempt evidence and replay control.',
    title: 'Webhook delivery · 3f4a…2b70',
  },
};

export const QueueHealthCard: Story = {
  args: {
    children: (
      <div className="qf-queue-row" aria-label="Request processing queue health">
        <div>
          <strong>request-processing</strong>
          <span>Running</span>
        </div>
        <div>
          <span>Waiting</span>
          <strong>18</strong>
        </div>
        <div>
          <span>Active</span>
          <strong>4</strong>
        </div>
        <div>
          <span>Delayed</span>
          <strong>2</strong>
        </div>
        <div>
          <span>Failed</span>
          <strong>0</strong>
        </div>
        <StatusBadge status="processing" label="working" />
      </div>
    ),
    description: 'BullMQ activity is summarized without replacing PostgreSQL as the authority.',
    title: 'Queue health',
  },
};
