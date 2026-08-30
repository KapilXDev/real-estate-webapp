import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";

import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { assertReadyForLaunch } from "@/config/launch-check";
import { site } from "@/config/site";
import "./globals.css";

/** Body text. Inter is neutral and highly legible at the small sizes listing specs need. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Display serif for headings. Carries the editorial feel that separates this from the portals —
 * variable optical sizing keeps it sharp from card headings up to hero type.
 */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

export const metadata: Metadata = {
  /**
   * Title template puts the page subject first — matters because Google truncates around 60
   * characters, and "3 Bed Home on Oak St | ..." reads far better in results than the agent's
   * name repeated on every listing.
   */
  title: {
    default: `${site.agent.name} | ${site.market.name} Property`,
    template: `%s | ${site.agent.name}`,
  },
  description: site.agent.tagline,
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: `${site.agent.name} | ${site.market.name} Property`,
  },
  robots: {
    // Sample-data builds must not be indexed. Presenting fabricated listings as real inventory
    // is a RERA advertising problem, not just an accuracy one.
    index: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
    follow: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
  },
};

/*
 * ⚠️ Runs on every render of every page, because there is no route that does not go through the
 * root layout — which is exactly why the check lives here rather than in a build script someone
 * can forget to run. It returns immediately unless NEXT_PUBLIC_SITE_URL is set, so it costs
 * nothing until the site is actually being served to the public.
 */
assertReadyForLaunch();

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${fraunces.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        {/* Skip link — search filter pages have long nav; keyboard users need the bypass. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
