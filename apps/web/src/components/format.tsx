'use client';

import { useState } from 'react';

import { Button, Check, Copy } from '@queueforge/ui';

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function DateTime({ value }: { readonly value: string }): React.JSX.Element {
  const date = new Date(value);
  return (
    <time className="qf-mono" dateTime={value} title={date.toISOString()}>
      {DATE_FORMATTER.format(date)}
    </time>
  );
}

export function CompactId({ value }: { readonly value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const short = value.length > 13 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <span className="qf-copy-id">
      <code title={value}>{short}</code>
      <Button
        aria-label={copied ? 'Copied identifier' : `Copy identifier ${value}`}
        icon={copied ? <Check size={14} /> : <Copy size={14} />}
        onClick={() => void copy()}
        tone="quiet"
      />
    </span>
  );
}
