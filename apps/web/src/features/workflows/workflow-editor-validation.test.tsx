import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import {
  WorkflowContentFields,
  WorkflowPolicyFields,
  focusDraftProblemField,
  type DraftProblemField,
  type EditorForm,
} from './workflow-editor-screen';

const defaults: EditorForm = {
  description: '',
  isEnabled: true,
  name: 'Expense review',
  preventSelfApproval: true,
  processingConfigText: '{"maxAttempts":5}',
  requestSchemaText: '{"type":"object"}',
  requiresApproval: true,
  targetsText: '[{"targetKind":"processor","position":0,"config":{"handler":"demo"}}]',
};

function ValidationHarness({
  field,
}: {
  readonly field: Exclude<DraftProblemField, 'root'>;
}): React.JSX.Element {
  const {
    formState: { errors },
    register,
    setError,
  } = useForm<EditorForm>({ defaultValues: defaults });

  useEffect(() => {
    setError(field, { message: 'Fix this exact control.' }, { shouldFocus: true });
    focusDraftProblemField(field);
  }, [field, setError]);

  const isPolicy = ['isEnabled', 'requiresApproval', 'preventSelfApproval'].includes(field);
  return isPolicy ? (
    <WorkflowPolicyFields editable errors={errors} register={register} />
  ) : (
    <WorkflowContentFields editable errors={errors} register={register} />
  );
}

describe('workflow editor validation accessibility', () => {
  it('associates a name contract issue with the name input and focuses it', async () => {
    render(<ValidationHarness field="name" />);
    const input = screen.getByRole('textbox', { name: 'Workflow name' });

    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Fix this exact control.');
  });

  it('associates a policy issue with its checkbox and focuses it', async () => {
    render(<ValidationHarness field="requiresApproval" />);
    const checkbox = screen.getByRole('checkbox', { name: /Require approval/ });

    await waitFor(() => expect(checkbox).toHaveFocus());
    expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    expect(checkbox).toHaveAccessibleDescription('Fix this exact control.');
  });
});
