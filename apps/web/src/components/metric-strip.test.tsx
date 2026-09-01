import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MetricStrip } from './metric-strip';

describe('MetricStrip', () => {
  it('keeps metric detail inside valid definition-list markup', () => {
    const { container } = render(
      <MetricStrip items={[{ detail: 'A person needs to decide', label: 'Waiting', value: 3 }]} />,
    );

    expect(screen.getByText('Waiting').tagName).toBe('DT');
    expect(screen.getByText('3').tagName).toBe('DD');
    expect(screen.getByText('A person needs to decide').tagName).toBe('DD');
    expect(container.querySelector('.qf-metric > span')).not.toBeInTheDocument();
  });
});
