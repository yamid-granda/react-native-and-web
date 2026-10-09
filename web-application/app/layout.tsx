import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { DesktopHeader } from "./desktop-header"
import { NavHeader } from "./nav-header"
import { Providers } from "./providers"
import { SsrStylesWrapper } from "./ssr-styles-wrapper"
import { SITE_URL } from "../lib/site"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "react-native-and-web",
    template: "%s · react-native-and-web",
  },
  description: "A marketplace with a server-rendered, SEO-friendly catalogue.",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <SsrStylesWrapper>
          <Providers>
            <DesktopHeader />
            {/* Container ladder (§8): phone full-bleed, tablet max-w-3xl,
                desktop max-w-6xl, wide max-w-7xl. Screens keep their own px. */}
            <div className="mx-auto w-full max-w-3xl lg:max-w-6xl xl:max-w-7xl">
              <div className="pb-20 lg:pb-8">{children}</div>
            </div>
            <NavHeader />
          </Providers>
        </SsrStylesWrapper>
      </body>
    </html>
  )
}
