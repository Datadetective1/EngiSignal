import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { brand } from '@/config/brand';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--es-font-inter',
});

export const metadata: Metadata = {
  metadataBase: new URL(brand.url),
  title: {
    default: brand.meta.title,
    template: brand.meta.titleTemplate,
  },
  description: brand.meta.description,
  keywords: [...brand.meta.keywords],
  applicationName: brand.name,
  openGraph: {
    type: 'website',
    siteName: brand.name,
    title: brand.meta.title,
    description: brand.meta.description,
    url: brand.url,
  },
  twitter: {
    card: brand.social.twitterCard,
    title: brand.meta.title,
    description: brand.meta.description,
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icon.svg' }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfcfd' },
    { media: '(prefers-color-scheme: dark)', color: '#08090b' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
