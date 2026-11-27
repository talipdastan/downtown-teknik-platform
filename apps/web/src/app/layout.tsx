import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaRegistrar } from '@/components/PwaRegistrar';
import { AppProviders } from './providers';

export const metadata: Metadata = {
  title: 'Downtown Teknik – Teknik Operasyon Yönetim Platformu',
  description:
    'Tek kullanıcı, tek giriş, tek veritabanı ile Downtown Teknik operasyon yönetim paneli',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Downtown Teknik',
  },
};

export const viewport: Viewport = {
  themeColor: '#17365D',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <head>
        <link rel="apple-touch-icon" href="/downtown-teknik-icon.png" />
      </head>
      <body className="min-h-screen antialiased">
        <AppProviders>
          <PwaRegistrar />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
