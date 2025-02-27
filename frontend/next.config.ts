import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'en.yts-official.mx',
        port: '',
        pathname: '/*',
        search: '',
      },
      {
        protocol: 'https',
        hostname: 'yts.mx',
        port: '',
        pathname: '/*',
        search: '',
      },
      {
        protocol: 'https',
        hostname: 'img.yts.mx',
        port: '',
        pathname: '/*',
        search: '',
      },
      {
        protocol: 'https',
        hostname: '*.yts.*',
        port: '',
        pathname: '/*',
        search: '',
      },
      {
        protocol: 'https',
        hostname: '*.yts-official.*',
        port: '',
        pathname: '/*',
        search: '',
      },
      {
        protocol: 'https',
        hostname: 'en.yts-official.mx',
        port: '',
        pathname: '/*',
        search: '',
      },
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
