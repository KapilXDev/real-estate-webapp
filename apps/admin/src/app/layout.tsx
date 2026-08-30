import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

/**
 * ⚠️ `robots: { index: false, follow: false }` on top of the unconditional robots.txt.
 *
 * Belt and braces: robots.txt is a request that a crawler may ignore, whereas the meta tag is
 * honoured by anything that renders the page. Neither alone is sufficient for a surface that
 * should never appear in a search result.
 */
export const metadata: Metadata = {
  title: { default: "Admin — Tricity Estate", template: "%s · Admin" },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * ⚠️ Only Inter is loaded, not the Fraunces display serif the public site uses.
 *
 * The editorial serif exists to make listing pages feel warm to a buyer. An admin tool is read at
 * a glance by someone doing data entry, where a serif is slower to scan and buys nothing — and it
 * is a second font download on every page of an app used all day.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
