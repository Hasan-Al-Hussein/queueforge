import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedTabs } from '@queueforge/ui';
import { describe, expect, it } from 'vitest';

const options = [
  { label: 'First view', value: 'first' },
  { label: 'Second view', value: 'second' },
  { label: 'Third view', value: 'third' },
] as const;

function Harness(): React.JSX.Element {
  const [value, setValue] = useState<(typeof options)[number]['value']>('first');

  return (
    <SegmentedTabs
      ariaLabel="Example views"
      onValueChange={setValue}
      options={options}
      value={value}
    >
      <p>{value} content</p>
    </SegmentedTabs>
  );
}

describe('SegmentedTabs', () => {
  it('connects the selected tab to a single labelled tab panel', () => {
    render(<Harness />);

    const tabList = screen.getByRole('tablist', { name: 'Example views' });
    const tabs = screen.getAllByRole('tab');
    const first = screen.getByRole('tab', { name: 'First view' });
    const second = screen.getByRole('tab', { name: 'Second view' });
    const third = screen.getByRole('tab', { name: 'Third view' });
    const panel = screen.getByRole('tabpanel');

    expect(tabList).toContainElement(first);
    expect(tabs).toHaveLength(3);
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('aria-selected', 'false');
    expect(second).toHaveAttribute('tabindex', '-1');
    expect(third).toHaveAttribute('tabindex', '-1');
    expect(tabs.every((tab) => tab.getAttribute('aria-controls') === panel.id)).toBe(true);
    expect(panel).toHaveAttribute('aria-labelledby', first.id);
    expect(panel).toHaveTextContent('first content');
  });

  it('activates and focuses tabs with arrow, Home, and End keys', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const first = screen.getByRole('tab', { name: 'First view' });
    const second = screen.getByRole('tab', { name: 'Second view' });
    const third = screen.getByRole('tab', { name: 'Third view' });
    const panel = screen.getByRole('tabpanel');

    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveTextContent('second content');

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(third).toHaveFocus();
    expect(third).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');
    expect(third).toHaveFocus();
    expect(third).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAttribute('aria-labelledby', third.id);
  });
});
