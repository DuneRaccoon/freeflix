import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { UserProvider } from '@/context/UserContext';
import { ThemeProvider } from '@/context/ThemeContext';
import AuthenticatedLayout from '@/components/layout/AuthenticatedLayout';

import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Freeflix',
  description: 'Freeflix',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} min-h-screen`}>
        <UserProvider>
          <ThemeProvider>
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
          </ThemeProvider>
        </UserProvider>
      </body>
    </html>
  );
}