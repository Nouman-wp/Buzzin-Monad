import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import { SessionProvider } from '@/components/shared/session';
import { appConfig } from '@/lib/config';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const displaySerif = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-display-serif',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(appConfig.appUrl),
  title: {
    default: 'BuzzIn — every event needs an icebreaker',
    template: '%s · BuzzIn',
  },
  description:
    'The icebreaker for any room. Scan, sign in, and play fast quiz, music and word rounds — everyone gets a wallet automatically, and the winnings settle on Monad.',
  applicationName: 'BuzzIn',
  openGraph: {
    title: 'BuzzIn — every event needs an icebreaker',
    description:
      'Scan, sign in, play. Fast rounds, a live leaderboard, and real settlement on Monad.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#040305',
  width: 'device-width',
  initialScale: 1,
  // Players tap fast and repeatedly; double-tap zoom would fight them.
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${displaySerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <SessionProvider>
          <div className="relative z-10 min-h-dvh">{children}</div>
        </SessionProvider>
      </body>
    </html>
  );
}
