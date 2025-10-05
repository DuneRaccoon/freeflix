import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'en.yts-official.mx',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'yts.mx',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'img.yts.mx',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'yts-official.mx',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'resizing.flixster.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'rottentomatoes.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'media-amazon.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'm.media-amazon.com',
        pathname: '/**',
      }
    ]
  },
  async rewrites() {
    return [
      // Keep internal Next API routes (like /api/palette) on the frontend
      { source: '/api/palette', destination: '/api/palette' },
      { source: '/api/palette/:path*', destination: '/api/palette/:path*' },
      // Proxy other API routes to backend
      {
        source: '/api/:path*',
        destination: 'http://localhost:8000/api/:path*',
      },
    ];
  },
};

export default nextConfig;