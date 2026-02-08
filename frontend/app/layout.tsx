import React from "react"
import type { Metadata } from 'next'
import { Space_Grotesk, IBM_Plex_Serif, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ProjectProvider } from '@/contexts/project-context'
import { Toaster } from 'sonner'
import './globals.css'

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: '--font-sans' });
const ibmPlexSerif = IBM_Plex_Serif({ subsets: ["latin"], weight: ['400', '600', '700'], variable: '--font-serif' });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'CuBot - Learn Embedded Software with AI',
  description: 'Code-based and no-code prototyping platform for junior embedded software talents. Write, compile, and test on virtual MCUs without buying hardware.',
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
    <html lang="en" className={`${spaceGrotesk.variable} ${ibmPlexSerif.variable} ${jetbrainsMono.variable}`}>
      <body className={`font-sans antialiased`}>
        <ProjectProvider>
          {children}
        </ProjectProvider>
        <Toaster position="top-right" />
        <Analytics />
      </body>
    </html>
  )
}
