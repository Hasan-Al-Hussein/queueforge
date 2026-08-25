import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GuidedRequestForm } from './guided-request-form';
import { readWorkflowSchema } from './workflow-schema';

const fields = readWorkflowSchema({
  type: 'object',
  required: ['amount', 'summary'],
  properties: {
    amount: { type: 'number', minimum: 1, title: 'Expense amount' },
    summary: { type: 'string', maxLength: 500, description: 'Explain what is needed.' },
    urgent: { type: 'boolean', title: 'Is this urgent?' },
  },
}).fields;

describe('GuidedRequestForm', () => {
  it('renders ordinary controls and reports changes without exposing JSON', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <GuidedRequestForm
        errors={{}}
        fields={fields}
        onChange={onChange}
        values={{ amount: '', summary: '', urgent: false }}
      />,
    );

    expect(screen.queryByText(/JSON/i)).not.toBeInTheDocument();
    await user.type(screen.getByRole('spinbutton', { name: 'Expense amount' }), '1250');
    await user.click(screen.getByRole('checkbox', { name: 'Is this urgent?' }));

    expect(onChange).toHaveBeenCalledWith('amount', '1');
    expect(onChange).toHaveBeenCalledWith('urgent', true);
  });

  it('associates friendly validation errors with the correct field', () => {
    render(
      <GuidedRequestForm
        errors={{ summary: 'Summary is required.' }}
        fields={fields}
        onChange={vi.fn()}
        values={{ amount: '', summary: '', urgent: false }}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveAccessibleDescription(
      'Summary is required.',
    );
  });
});
