import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
// import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { AuthGuard } from '@/components/auth-guard'
import { Toaster } from '@/components/ui/sonner'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Programmable Inbox - Disposable Email & Phone Numbers',
  description: 'Manage disposable email addresses and phone numbers',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  if (typeof window !== 'undefined' && typeof chrome === 'undefined') {
                    window.chrome = {};
                  }
                } catch (e) {
                  // Ignore errors
                }
              })();
            `,
          }}
        />
      </head>
      <body className={`font-sans antialiased`}>
        <AuthGuard>
          {children}
        </AuthGuard>
        <Toaster />
        {/* <Analytics /> */}
      </body>
    </html>
  )
}
