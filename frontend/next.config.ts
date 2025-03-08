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
      }
    ]
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8000/api/:path*',
      },
    ];
  },
};

export default nextConfig;