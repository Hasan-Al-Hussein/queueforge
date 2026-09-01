import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

import {
  MobileStepNavigator,
  SetupNavigation,
  WorkflowContentFields,
  WorkflowEditorStageBody,
  WorkflowPolicyFields,
  focusDraftProblemField,
  workflowSetupCompletion,
  workflowSetupStepForProblemField,
  type DraftProblemField,
  type EditorForm,
  type WorkflowSetupStep,
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
    setValue,
    watch,
  } = useForm<EditorForm>({ defaultValues: defaults });
  // React Hook Form owns the test harness subscription; React Compiler intentionally skips it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const values = watch();

  useEffect(() => {
    setError(field, { message: 'Fix this exact control.' }, { shouldFocus: true });
    focusDraftProblemField(field);
  }, [field, setError]);

  const isPolicy = ['isEnabled', 'requiresApproval', 'preventSelfApproval'].includes(field);
  return isPolicy ? (
    <WorkflowPolicyFields editable errors={errors} register={register} />
  ) : (
    <WorkflowContentFields
      editable
      errors={errors}
      register={register}
      setValue={setValue}
      values={values}
    />
  );
}

function ContentHarness({
  activeMobileStep,
}: {
  readonly activeMobileStep: WorkflowSetupStep;
}): React.JSX.Element {
  const {
    formState: { errors },
    register,
    setValue,
    watch,
  } = useForm<EditorForm>({ defaultValues: defaults });
  // React Hook Form owns the test harness subscription; React Compiler intentionally skips it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const values = watch();
  return (
    <WorkflowContentFields
      activeMobileStep={activeMobileStep}
      editable
      errors={errors}
      register={register}
      setValue={setValue}
      values={values}
    />
  );
}

describe('workflow editor validation accessibility', () => {
  it('associates a name contract issue with the name input and focuses it', async () => {
    render(<ValidationHarness field="name" />);
    const input = screen.getByRole('textbox', { name: 'Request type name' });

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

describe('workflow editor mobile progressive disclosure', () => {
  it('maps every validation field to the setup step that owns its control', () => {
    expect(workflowSetupStepForProblemField('name')).toBe(0);
    expect(workflowSetupStepForProblemField('description')).toBe(0);
    expect(workflowSetupStepForProblemField('requestSchemaText')).toBe(1);
    expect(workflowSetupStepForProblemField('requiresApproval')).toBe(2);
    expect(workflowSetupStepForProblemField('preventSelfApproval')).toBe(2);
    expect(workflowSetupStepForProblemField('isEnabled')).toBe(2);
    expect(workflowSetupStepForProblemField('processingConfigText')).toBe(3);
    expect(workflowSetupStepForProblemField('targetsText')).toBe(4);
  });

  it('marks one mobile step active while keeping every form control mounted', () => {
    render(<ContentHarness activeMobileStep={3} />);

    expect(screen.getByRole('region', { name: 'Choose how processing behaves' })).toHaveAttribute(
      'data-mobile-active',
      'true',
    );
    expect(
      screen.getByRole('region', { name: 'Name and explain this request type' }),
    ).toHaveAttribute('data-mobile-active', 'false');
    expect(document.getElementById('editor-name')).toBeInTheDocument();
    expect(document.getElementById('editor-request-schema')).toBeInTheDocument();
    expect(document.getElementById('editor-requires-approval')).toBeInTheDocument();
    expect(document.getElementById('editor-processing-policy')).toBeInTheDocument();
    expect(document.getElementById('editor-targets')).toBeInTheDocument();
  });

  it('exposes the active rail step with aria-current and preserves direct step selection', async () => {
    const onSelectStep = vi.fn();
    const user = userEvent.setup();
    render(<SetupNavigation activeStep={2} onSelectStep={onSelectStep} />);

    expect(screen.getByRole('link', { name: /Decision gate/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await user.click(screen.getByRole('link', { name: /Processing/ }));
    expect(onSelectStep).toHaveBeenCalledWith(3);
  });

  it('provides bounded Previous and Next controls for the active mobile step', async () => {
    const onStepChange = vi.fn();
    const user = userEvent.setup();
    render(<MobileStepNavigator activeStep={0} onStepChange={onStepChange} />);

    expect(screen.getByText('Step 1 of 5')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it('shows a tappable five-stage mobile rail with current and completed state', async () => {
    const onStepChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MobileStepNavigator
        activeStep={2}
        completedSteps={[true, true, true, false, false]}
        onStepChange={onStepChange}
      />,
    );

    expect(screen.getAllByRole('button', { name: /^Step \d:/ })).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Step 3: Decision gate, current' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(
      screen.getByRole('button', { name: 'Step 1: Identity, complete' }).closest('li'),
    ).toHaveAttribute('data-state', 'complete');

    await user.click(screen.getByRole('button', { name: 'Step 5: Delivery path' }));
    expect(onStepChange).toHaveBeenCalledWith(4);
  });

  it('keeps mobile stage wayfinding beside a published read-only summary', () => {
    render(
      <WorkflowEditorStageBody
        activeStep={1}
        completedSteps={[true, true, true, true, true]}
        onStepChange={vi.fn()}
      >
        <p>Published and read-only</p>
      </WorkflowEditorStageBody>,
    );

    expect(
      screen.getByRole('navigation', { name: 'Current request type setup step' }),
    ).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Step \d:/ })).toHaveLength(5);
    expect(screen.getByText('Published and read-only')).toBeVisible();
  });

  it('derives completion state from the mounted workflow configuration', () => {
    expect(workflowSetupCompletion(defaults)).toEqual([true, false, true, true, true]);
    expect(
      workflowSetupCompletion({
        ...defaults,
        processingConfigText: '{not-json}',
        targetsText: '[]',
      }),
    ).toEqual([true, false, true, false, false]);
  });
});
