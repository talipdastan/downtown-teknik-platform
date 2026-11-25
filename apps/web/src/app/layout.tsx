import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Downtown Teknik – Teknik Operasyon Yönetim Platformu',
  description: 'Tek kullanıcı, tek giriş, tek veritabanı ile Downtown Teknik operasyon yönetim paneli',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
