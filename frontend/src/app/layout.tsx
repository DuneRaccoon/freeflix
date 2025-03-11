import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Navigation from '@/components/ui/Navigation';
import { Toaster } from 'react-hot-toast';
import { UserProvider } from '@/context/UserContext';

import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'YIFY Downloader',
  description: 'A modern interface for downloading YIFY movies',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-background text-foreground min-h-screen`}>
        <UserProvider>
          <Navigation />
          <main className="container mx-auto py-6 px-4">
            {children}
          </main>
          <Toaster 
            position="top-right"
            toastOptions={{
              style: {
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
              },
              success: {
                iconTheme: {
                  primary: '#10b981',
                  secondary: '#f8fafc',
                },
              },
              error: {
                iconTheme: {
                  primary: '#ef4444',
                  secondary: '#f8fafc',
                },
              },
            }}
          />
        </UserProvider>
      </body>
    </html>
  );
}