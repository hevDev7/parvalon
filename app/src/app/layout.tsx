import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Parvalon — the corporate-actions layer for tokenized stocks",
  description:
    "On-chain dividends, splits, and record-date semantics for tokenized stocks. Permissionless. Works on the tokens that already exist — no token changes, no issuer integration required.",
  metadataBase: new URL("https://parvalon.xyz"),
  openGraph: {
    title: "Parvalon",
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
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
