import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { AppProviders } from '../src/providers/app-providers';

import './globals.css';

const plusJakartaSansFont = localFont({
  display: 'swap',
  fallback: ['Segoe UI Variable', 'Segoe UI', 'Arial', 'sans-serif'],
  preload: true,
  src: '../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2',
  variable: '--qf-font-plus-jakarta-sans-source',
  weight: '200 800',
});

const plexMonoFont = localFont({
  display: 'swap',
  fallback: ['Cascadia Code', 'Consolas', 'monospace'],
  preload: false,
  src: [
    {
      path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
      weight: '400',
    },
    {
      path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2',
      weight: '500',
    },
    {
      path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2',
      weight: '600',
    },
  ],
  variable: '--qf-font-plex-mono-source',
});

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
    <html
      className={`${plusJakartaSansFont.variable} ${plexMonoFont.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
