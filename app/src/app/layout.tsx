import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { Ticker } from "@/components/Ticker";
import { SiteFooter } from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "CorporaX — the corporate-actions layer for tokenized stocks",
  description:
    "On-chain dividends, splits, and record-date semantics for tokenized stocks. Permissionless. Works on the tokens that already exist — no token changes, no issuer integration required.",
  metadataBase: new URL("https://corporax.xyz"),
  openGraph: {
    title: "CorporaX",
    description: "The missing corporate-actions layer for tokenized stocks.",
    type: "website",
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <Ticker />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
