import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/**',
      },
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
  async redirects() {
    return [
      { source: '/my-movies', destination: '/my-list', permanent: true },
    ];
  },
  async rewrites() {
    // In Docker the backend is reachable at http://backend:8000; locally it
    // defaults to http://localhost:8000. Set BACKEND_INTERNAL_URL to override.
    const backendUrl = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:8000';
    return [
      // Keep internal Next API routes (like /api/palette) on the frontend
      { source: '/api/palette', destination: '/api/palette' },
      { source: '/api/palette/:path*', destination: '/api/palette/:path*' },
      // /api/internal/* is ours (the mail render+send route FastAPI posts to with a
      // shared-secret header). Returning a plain array makes these `afterFiles`
      // rewrites, so the static /api/internal/mail file already beats the catch-all
      // below — this keeps that true if the path ever gains a dynamic segment, which
      // would otherwise be proxied to the backend with the secret still attached.
      { source: '/api/internal/:path*', destination: '/api/internal/:path*' },
      // Proxy other API routes to backend
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      // Backend system endpoints that live outside /api/v1 (root status + /health),
      // proxied so the browser reaches them same-origin instead of a hard-coded host.
      {
        source: '/_backend/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;