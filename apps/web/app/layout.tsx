import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Liveline — live sportsbook demo',
  description:
    'Real-time odds over WebSocket: synthetic feed, uWebSockets.js gateway, Next.js client.',
};

export const viewport: Viewport = {
  themeColor: '#0b0f14',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
