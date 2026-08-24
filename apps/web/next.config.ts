import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
