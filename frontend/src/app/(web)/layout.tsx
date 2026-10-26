import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter_Tight } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { SessionProvider } from '@/context/SessionContext';
import { UserProvider } from '@/context/UserContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ProgressProvider } from '@/context/ProgressContext';
import { WatchlistProvider } from '@/context/WatchlistContext';
import AuthenticatedLayout from '@/components/layout/AuthenticatedLayout';
import ServiceWorkerRegistrar from '@/components/pwa/ServiceWorkerRegistrar';

import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});
const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FRÈ',
  description: 'FRÈ — your cinema, kept close.',
  // Installable app. The manifest, worker and icons are static files in public/; the TV
  // surface's own root layout links none of them.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: { url: '/icons/apple-touch-icon.png', sizes: '180x180' },
  },
  appleWebApp: {
    capable: true,
    title: 'FRÈ',
    // 'black', not 'black-translucent': translucent draws the page under the status bar,
    // and nothing in the shell pads for the safe area.
    statusBarStyle: 'black',
  },
};

export const viewport: Viewport = {
  themeColor: '#0A0A0B',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${fraunces.variable} ${interTight.variable}`}>
      <body className="min-h-screen font-ui">
        <ServiceWorkerRegistrar />
        <SessionProvider>
        <UserProvider>
          <ThemeProvider>
            <ProgressProvider>
              <WatchlistProvider>
              <AuthenticatedLayout>
                {children}
              </AuthenticatedLayout>
              </WatchlistProvider>
              <Toaster
                position="top-right"
                toastOptions={{
                  style: {
                    background: 'var(--color-surface)',
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-hairline)',
                  },
                  success: {
                    iconTheme: {
                      primary: 'var(--color-gold)',
                      secondary: 'var(--color-ink)',
                    },
                  },
                  error: {
                    iconTheme: {
                      primary: 'var(--color-danger)',
                      secondary: 'var(--color-ink)',
                    },
                  },
                }}
              />
            </ProgressProvider>
          </ThemeProvider>
        </UserProvider>
        </SessionProvider>
      </body>
    </html>
  );
}