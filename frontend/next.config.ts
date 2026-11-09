import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: currentDir,
  },
  async rewrites() {
    return [
      {
        source: "/cctv-hls/:path*",
        destination: "http://36.66.208.101:5000/hls/:path*",
      },
    ];
  },
};

export default nextConfig;
