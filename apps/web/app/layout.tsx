import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '../src/providers/app-providers';

import './globals.css';

export const metadata: Metadata = {
  description:
    'Local workflow operations console for durable requests, approvals, queues, and webhooks.',
  title: {
    default: 'QueueForge',
    template: '%s · QueueForge',
  },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  initialScale: 1,
  width: 'device-width',
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
