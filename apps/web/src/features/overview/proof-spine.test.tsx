import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProofSpine } from './proof-spine';

const items = [
  { id: 'intake', label: '326 requests received', state: 'complete' as const },
  { id: 'decision', label: '326 waiting for approval', state: 'current' as const },
  { id: 'processing', label: 'No work in flight', state: 'complete' as const },
  { id: 'delivery', label: 'No delivery failures', state: 'complete' as const },
];

describe('ProofSpine', () => {
  it('exposes one consistent illustrative request flow to keyboard users', async () => {
    const user = userEvent.setup();
    const onSelectStage = vi.fn();
    render(<ProofSpine items={items} onSelectStage={onSelectStage} selectedStageIndex={1} />);

    expect(screen.getByRole('list', { name: 'Illustrative proof cycle stages' })).toHaveAttribute(
      'data-proof-scenario',
      'illustrative-request',
    );
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(
      screen.getByRole('button', {
        name: /Decision: Independent witness signed\. Illustrative request transformation/i,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/326 waiting/i)).not.toBeInTheDocument();

    await user.tab();
    expect(
      screen.getByRole('button', {
        name: /Intake: Schema and request hash locked\. Illustrative request transformation/i,
      }),
    ).toHaveFocus();
    expect(onSelectStage).toHaveBeenLastCalledWith(0);

    await user.tab();
    expect(
      screen.getByRole('button', {
        name: /Decision: Independent witness signed\. Illustrative request transformation/i,
      }),
    ).toHaveFocus();
    expect(onSelectStage).toHaveBeenLastCalledWith(1);
  });

  it('clamps an invalid visual selection to the available stages', () => {
    render(<ProofSpine items={items} onSelectStage={() => undefined} selectedStageIndex={99} />);

    expect(
      screen.getByRole('button', {
        name: /Delivery: Signed delivery receipt sealed\. Illustrative request transformation/i,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('moves visible and semantic selection with the automatic proof cycle', () => {
    const { rerender } = render(
      <ProofSpine items={items} onSelectStage={() => undefined} selectedStageIndex={0} />,
    );

    expect(
      screen.getByRole('button', {
        name: /Intake: Schema and request hash locked\. Illustrative request transformation/i,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Schema locked')).toBeInTheDocument();
    expect(screen.getByText('Retries retained')).toBeInTheDocument();

    rerender(<ProofSpine items={items} onSelectStage={() => undefined} selectedStageIndex={2} />);

    expect(
      screen.getByRole('button', {
        name: /Process: Failed retry attempts retained with the surviving attempt/i,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', {
        name: /Intake: Schema and request hash locked\. Illustrative request transformation/i,
      }),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
