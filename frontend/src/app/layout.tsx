import type { Metadata } from 'next';
import { Fraunces, Inter_Tight } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { UserProvider } from '@/context/UserContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ProgressProvider } from '@/context/ProgressContext';
import AuthenticatedLayout from '@/components/layout/AuthenticatedLayout';

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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${fraunces.variable} ${interTight.variable}`}>
      <body className="min-h-screen font-ui">
        <UserProvider>
          <ThemeProvider>
            <ProgressProvider>
              <AuthenticatedLayout>
                {children}
              </AuthenticatedLayout>
              <Toaster 
                position="top-right"
                toastOptions={{
                  style: {
                    background: 'var(--color-card)',
                    color: 'var(--color-foreground)',
                    border: '1px solid var(--color-border)',
                  },
                  success: {
                    iconTheme: {
                      primary: 'var(--color-primary)',
                      secondary: 'var(--color-primary-foreground)',
                    },
                  },
                  error: {
                    iconTheme: {
                      primary: 'var(--color-danger)',
                      secondary: 'var(--color-primary-foreground)',
                    },
                  },
                }}
              />
            </ProgressProvider>
          </ThemeProvider>
        </UserProvider>
      </body>
    </html>
  );
}