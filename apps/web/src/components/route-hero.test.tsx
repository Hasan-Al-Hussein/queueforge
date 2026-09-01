import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CinematicMotionProvider } from './cinematic-motion';
import { HeroMetrics, HeroRail, RouteHero } from './route-hero';

function renderHero(): void {
  render(
    <CinematicMotionProvider>
      <RouteHero
        actions={<button type="button">Primary action</button>}
        description="Move a durable request through accountable handoffs."
        eyebrow="Operator workspace"
        meta={<span>Four retained stages</span>}
        title="Proof Spine"
        visual={
          <HeroMetrics
            items={[
              { label: 'Waiting', value: 3, tone: 'warning' },
              { label: 'Complete', value: 12, tone: 'signal' },
            ]}
          />
        }
      />
    </CinematicMotionProvider>,
  );
}

describe('RouteHero', () => {
  it('keeps one semantic page heading and keyboard-reachable actions', () => {
    renderHero();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const heading = screen.getByRole('heading', { level: 1, name: 'Proof Spine' });
    const action = screen.getByRole('button', { name: 'Primary action' });
    const visualMetric = screen.getByText('Waiting');
    expect(heading).toBeInTheDocument();
    expect(action).toBeEnabled();
    expect(heading.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(
      action.compareDocumentPosition(visualMetric) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.getByText('Four retained stages')).toBeInTheDocument();
    expect(
      screen.getByText('Move a durable request through accountable handoffs.'),
    ).toBeInTheDocument();
  });

  it('labels metrics and marks the current proof stage', () => {
    render(
      <HeroRail
        ariaLabel="Request proof stages"
        items={[
          { label: 'Intake', state: 'complete' },
          { description: 'A person is deciding.', label: 'Decision', state: 'current' },
          { label: 'Processing', state: 'upcoming' },
          { label: 'Signed outcome', state: 'upcoming' },
        ]}
      />,
    );

    const rail = screen.getByRole('list', { name: 'Request proof stages' });
    expect(within(rail).getAllByRole('listitem')).toHaveLength(4);
    expect(within(rail).getByText('Decision').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(within(rail).getByText('A person is deciding.')).toBeVisible();
  });
});
