import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image: .next/standalone/server.js.
  output: 'standalone',
};

const allowedDevOrigins = process.env.ALLOWED_DEV_ORIGINS?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (allowedDevOrigins && allowedDevOrigins.length > 0) {
  nextConfig.allowedDevOrigins = allowedDevOrigins;
}

export default nextConfig;
