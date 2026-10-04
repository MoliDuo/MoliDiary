import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AppToaster } from '@/components/AppToaster';
import { getSettings } from '@/lib/settings';
import { themeBackgroundColor } from '@/lib/theme';

// A per-request CSP nonce requires Next.js to render scripts dynamically.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Moli Diary', template: '%s · Moli Diary' },
  description: 'A personal diary app',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      '/favicon.ico',
      '/icon.png',
    ],
    apple: '/apple-icon.png',
  },
  robots: { index: false, follow: false, noarchive: true, nocache: true },
};

export async function generateViewport(): Promise<Viewport> {
  const { theme } = await getSettings();
  return { themeColor: themeBackgroundColor(theme) };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { theme } = await getSettings();
  return (
    <html lang="zh-CN" data-theme={theme}>
      <body data-app="diary" className="antialiased">
        {children}
        <AppToaster theme={theme} />
      </body>
    </html>
  );
}
