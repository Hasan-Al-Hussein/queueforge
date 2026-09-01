import type { NextConfig } from 'next';

const showcaseMode = process.env['NEXT_PUBLIC_QUEUEFORGE_MODE'] === 'showcase';

const nextConfig: NextConfig = {
  env: {
    QF_DATA_ORIGIN: showcaseMode
      ? ''
      : (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:3001'),
    QF_QUERY_ORIGIN: showcaseMode
      ? ''
      : (process.env['NEXT_PUBLIC_GRAPHQL_URL'] ?? 'http://127.0.0.1:3001/graphql'),
    QF_RECEIVER_HELP: showcaseMode
      ? 'Use a synthetic HTTPS receiver address, such as https://receiver.queueforge.test/events.'
      : 'For the bundled demo, use http://127.0.0.1:3300/webhooks. Docker installations can use http://webhook-sink:3300/webhooks.',
  },
  output: 'export',
  poweredByHeader: false,
  reactStrictMode: true,
  trailingSlash: true,
  typedRoutes: true,
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
};

export default nextConfig;
