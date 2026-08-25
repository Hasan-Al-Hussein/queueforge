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
  title: 'QueueForge/Workspace states',
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OperationalPanel: Story = {
  args: {
    actions: (
      <Button icon={<Plus size={16} />} tone="primary">
        Start request
      </Button>
    ),
    children: (
      <QueueRail
        items={[
          { id: '1', label: 'Request received', state: 'complete', timestamp: '10:42:11' },
          {
            id: '2',
            label: 'Waiting for approval',
            description: 'Decision required from an approver.',
            state: 'current',
            timestamp: '10:42:12',
          },
          { id: '3', label: 'Ready to start', state: 'pending' },
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
        action={<Button>Create a request type</Button>}
        description="Activate a request type before an operator can use it."
        kind="empty"
        title="No request activity yet"
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
          label="Request type name"
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

export const DraftConflict: Story = {
  args: {
    children: (
      <div className="qf-inline-alert">
        <AlertTriangle size={18} />
        <p>
          Someone else changed this draft. Choose the saved copy or keep the changes in this tab.
        </p>
      </div>
    ),
    title: 'Draft changes need review',
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
        <table aria-label="Recent requests">
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Request type</th>
              <th scope="col">Status</th>
              <th scope="col">Started from</th>
              <th scope="col">Submitted</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>8f0b…43a2</code>
              </td>
              <td>Expense review</td>
              <td>
                <StatusBadge status="pending_approval" label="Waiting for approval" />
              </td>
              <td>QueueForge form</td>
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
                <StatusBadge status="succeeded" label="Completed" />
              </td>
              <td>External integration</td>
              <td>
                <time dateTime="2026-08-24T12:39:04Z">24 Aug, 16:39</time>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    ),
    description: 'Readable tables keep technical references available without leading with them.',
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
            description: 'Omar Operator started the request from the QueueForge form.',
            id: 'audit-1',
            label: 'Request started',
            state: 'complete',
            timestamp: '16:42:11',
          },
          {
            description: 'QueueForge sent the request to an approver.',
            id: 'audit-2',
            label: 'Approval requested',
            state: 'complete',
            timestamp: '16:42:12',
          },
          {
            description: 'A decision is waiting in the approval workspace.',
            id: 'audit-3',
            label: 'Waiting for approval',
            state: 'current',
            timestamp: '16:42:12',
          },
        ]}
      />
    ),
    description: 'Plain-language activity keeps actor, action, and request order understandable.',
    title: 'Activity log',
  },
};

export const ApprovalCard: Story = {
  args: {
    children: (
      <article aria-labelledby="approval-card-title">
        <div className="qf-notification__title">
          <h3 id="approval-card-title">Expense review · AED 18,750</h3>
          <StatusBadge status="pending" label="Waiting for you" />
        </div>
        <dl className="qf-role-list">
          <div>
            <dt>Requested by</dt>
            <dd>Omar Operator · Operations</dd>
          </div>
          <div>
            <dt>Request details</dt>
            <dd>Amount: AED 18,750 · Cost center: OPS-42</dd>
          </div>
        </dl>
        <div className="qf-row-actions" aria-label="Approval actions">
          <Button tone="primary">Approve</Button>
          <Button tone="danger">Decline</Button>
        </div>
      </article>
    ),
    description: 'A decision shows the requester and important facts in readable language.',
    title: 'Approval decision',
  },
};

export const WebhookDeliveryPanel: Story = {
  args: {
    actions: <Button>Try again</Button>,
    children: (
      <dl className="qf-role-list">
        <div>
          <dt>Delivery status</dt>
          <dd>
            <StatusBadge status="retry" label="Another try scheduled" />
          </dd>
        </div>
        <div>
          <dt>Destination</dt>
          <dd>Local audit sink · Request approved</dd>
        </div>
        <div>
          <dt>Related request</dt>
          <dd>Expense review · reference 8f0b…43a2</dd>
        </div>
        <div>
          <dt>Next try</dt>
          <dd>
            <time dateTime="2026-08-24T12:47:30Z">24 Aug 2026, 16:47:30</time>
          </dd>
        </div>
      </dl>
    ),
    description: 'Readable result-delivery status with technical evidence available on demand.',
    title: 'Result delivery',
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
