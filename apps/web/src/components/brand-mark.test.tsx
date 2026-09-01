import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  it('stays decorative, token-addressable, and free of the retired circular silhouette', () => {
    const { container } = render(<BrandMark compact data-testid="brand-mark" />);
    const mark = container.querySelector('[data-testid="brand-mark"]');

    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveAttribute('focusable', 'false');
    expect(mark).toHaveAttribute('viewBox', '0 0 48 48');
    expect(mark).toHaveClass('qf-brand-mark', 'qf-brand-mark--compact');
    expect(mark?.querySelector('.qf-brand-mark__gate')).not.toBeNull();
    expect(mark?.querySelector('.qf-brand-mark__node')?.tagName).toBe('path');
    expect(mark?.querySelector('circle')).toBeNull();
  });
});
