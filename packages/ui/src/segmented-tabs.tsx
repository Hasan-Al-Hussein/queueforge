'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from './cn.js';

export interface SegmentedTabOption<TValue extends string> {
  readonly label: ReactNode;
  readonly value: TValue;
}

export interface SegmentedTabsProps<TValue extends string> {
  readonly ariaLabel: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly onValueChange: (value: TValue) => void;
  readonly options: readonly SegmentedTabOption<TValue>[];
  readonly value: TValue;
}

type NavigationKey = 'ArrowLeft' | 'ArrowRight' | 'End' | 'Home';

function nextTabIndex(key: NavigationKey, currentIndex: number, tabCount: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return tabCount - 1;
  if (key === 'ArrowLeft') return (currentIndex - 1 + tabCount) % tabCount;
  return (currentIndex + 1) % tabCount;
}

export function SegmentedTabs<TValue extends string>({
  ariaLabel,
  children,
  className,
  onValueChange,
  options,
  value,
}: SegmentedTabsProps<TValue>): React.JSX.Element {
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const panelId = `${tabsId}-panel`;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (!['ArrowLeft', 'ArrowRight', 'End', 'Home'].includes(event.key)) return;
    if (options.length === 0) return;

    event.preventDefault();
    const targetIndex = nextTabIndex(event.key as NavigationKey, index, options.length);
    const target = options[targetIndex];
    if (target === undefined) return;

    onValueChange(target.value);
    tabRefs.current[targetIndex]?.focus();
  };

  return (
    <div className={cn('qf-segmented-tabs', className)}>
      <div aria-label={ariaLabel} className="qf-segmented" role="tablist">
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              aria-controls={panelId}
              aria-selected={selected}
              id={`${tabsId}-tab-${String(index)}`}
              key={option.value}
              onClick={() => onValueChange(option.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div
        aria-labelledby={
          selectedIndex === -1 ? undefined : `${tabsId}-tab-${String(selectedIndex)}`
        }
        className="qf-segmented-tabs__panel"
        id={panelId}
        role="tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
