import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { NavHeader } from "./nav-header"
import { Providers } from "./providers"
import { SsrStylesWrapper } from "./ssr-styles-wrapper"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "react-native-and-web",
  description: "Boilerplate: Next.js (SSR) + Expo sharing one React Native component library",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <SsrStylesWrapper>
          <Providers>
            <NavHeader />
            {children}
          </Providers>
        </SsrStylesWrapper>
      </body>
    </html>
  )
}
