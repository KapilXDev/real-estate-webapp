"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { site } from "@/config/site";
import { cn } from "@/lib/cn";

/**
 * Primary navigation.
 *
 * Order reflects the 70/30 buyer/seller weighting the realtor set: buyer paths come first, the
 * seller valuation funnel sits as the standout CTA. "Home Value" is styled as the primary action
 * despite being the seller path because it is by far the highest-converting page on the site
 * (5-15% vs ~1%) — the one link worth making impossible to miss.
 */

const NAV_LINKS = [
  { href: "/search", label: "Search Homes" },
  { href: "/neighborhoods", label: "Neighborhoods" },
  { href: "/listings", label: "Our Listings" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-50 border-b border-sand-200 bg-sand-50/95 backdrop-blur supports-[backdrop-filter]:bg-sand-50/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex flex-col leading-tight" onClick={() => setMobileOpen(false)}>
          <span className="font-display text-lg font-semibold tracking-tight text-brand-800">
            {site.agent.name}
          </span>
          <span className="text-[11px] uppercase tracking-[0.14em] text-sand-500">
            {site.agent.title}
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(link.href)
                  ? "text-brand-700"
                  : "text-sand-700 hover:text-brand-700",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          {/* Click-to-call: a meaningful share of buyers would rather ring than fill a form. */}
          <a
            href={`tel:${site.agent.phone.replace(/[^\d+]/g, "")}`}
            className="text-sm font-medium text-sand-700 transition-colors hover:text-brand-700"
          >
            {site.agent.phone}
          </a>
          <Link
            href="/home-value"
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
          >
            What&rsquo;s My Home Worth?
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          className="inline-flex items-center justify-center rounded-md p-2 text-sand-700 lg:hidden"
        >
          <span className="sr-only">{mobileOpen ? "Close menu" : "Open menu"}</span>
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="border-t border-sand-200 bg-sand-50 lg:hidden"
        >
          <div className="space-y-1 px-4 py-3">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-2.5 text-base font-medium",
                  isActive(link.href)
                    ? "bg-brand-50 text-brand-800"
                    : "text-sand-800 hover:bg-sand-100",
                )}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/home-value"
              onClick={() => setMobileOpen(false)}
              className="mt-2 block rounded-md bg-brand-700 px-3 py-2.5 text-center text-base font-semibold text-white"
            >
              What&rsquo;s My Home Worth?
            </Link>
            <a
              href={`tel:${site.agent.phone.replace(/[^\d+]/g, "")}`}
              className="block px-3 py-2.5 text-center text-base font-medium text-sand-700"
            >
              Call {site.agent.phone}
            </a>
          </div>
        </nav>
      )}
    </header>
  );
}
