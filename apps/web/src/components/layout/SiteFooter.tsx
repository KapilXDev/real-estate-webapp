import Link from "next/link";

import { neighborhoods } from "@/config/neighborhoods";
import { site } from "@/config/site";
import { getListingProvider } from "@/lib/listings";

/**
 * Site footer, including the required compliance block.
 *
 * The bottom section carries the legally mandated items: Equal Housing Opportunity notice, agent
 * and brokerage license numbers, the MLS disclaimer, and the copyright line. These are not
 * decorative — do not remove them to tidy the design.
 *
 * The MLS disclaimer only prints when the provider serves live MLS data, because printing a
 * board's disclaimer over sample listings would claim provenance we don't have.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const isLive = getListingProvider().isLiveMlsData;

  return (
    <footer className="mt-auto border-t border-sand-200 bg-sand-100">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-4">
          <div>
            <p className="font-display text-lg font-semibold text-brand-800">
              {site.agent.name}
            </p>
            <p className="mt-1 text-sm text-sand-600">{site.agent.title}</p>
            <p className="mt-4 text-sm leading-relaxed text-sand-700">
              {site.agent.tagline}
            </p>
            <div className="mt-4 space-y-1 text-sm">
              <a
                href={`tel:${site.agent.phone.replace(/[^\d+]/g, "")}`}
                className="block text-brand-700 hover:underline"
              >
                {site.agent.phone}
              </a>
              <a
                href={`mailto:${site.agent.email}`}
                className="block text-brand-700 hover:underline"
              >
                {site.agent.email}
              </a>
            </div>
          </div>

          <div>
            <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-sand-900">
              Buying
            </h2>
            <ul className="mt-4 space-y-2 text-sm">
              <li><Link href="/search" className="text-sand-700 hover:text-brand-700">Search Homes</Link></li>
              <li><Link href="/listings" className="text-sand-700 hover:text-brand-700">Our Listings</Link></li>
              <li><Link href="/neighborhoods" className="text-sand-700 hover:text-brand-700">Neighborhood Guides</Link></li>
              <li><Link href="/mortgage-calculator" className="text-sand-700 hover:text-brand-700">Mortgage Calculator</Link></li>
            </ul>
          </div>

          <div>
            <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-sand-900">
              Selling
            </h2>
            <ul className="mt-4 space-y-2 text-sm">
              <li><Link href="/home-value" className="text-sand-700 hover:text-brand-700">What&rsquo;s My Home Worth?</Link></li>
              <li><Link href="/market-reports" className="text-sand-700 hover:text-brand-700">Market Reports</Link></li>
              <li><Link href="/contact" className="text-sand-700 hover:text-brand-700">Request a Consultation</Link></li>
            </ul>
          </div>

          <div>
            <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-sand-900">
              Neighborhoods
            </h2>
            {/* Footer links to neighborhood pages help Google discover and weight them. */}
            <ul className="mt-4 space-y-2 text-sm">
              {neighborhoods.slice(0, 6).map((n) => (
                <li key={n.slug}>
                  <Link
                    href={`/neighborhoods/${n.slug}`}
                    className="text-sand-700 hover:text-brand-700"
                  >
                    {n.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---- Compliance block. Legally required. Do not remove. ---- */}
        <div className="mt-12 border-t border-sand-300 pt-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            {site.compliance.equalHousing && (
              <div className="flex items-center gap-2">
                <EqualHousingIcon />
                <span className="text-xs font-medium text-sand-700">
                  Equal Housing Opportunity
                </span>
              </div>
            )}
            <div className="space-y-1 text-xs leading-relaxed text-sand-600">
              <p>
                {site.agent.name}, {site.agent.title} · {site.agent.licenseNumber}
              </p>
              <p>
                {site.brokerage.name} · {site.brokerage.licenseNumber} ·{" "}
                {site.brokerage.address}
              </p>
            </div>
          </div>

          {isLive ? (
            <div className="mt-6 space-y-2 text-[11px] leading-relaxed text-sand-500">
              <p>{site.compliance.mlsDisclaimer}</p>
              <p>{site.compliance.mlsCopyright.replace("{year}", String(year))}</p>
            </div>
          ) : (
            /* Dev-only notice. Disappears automatically once a live provider is configured. */
            <p className="mt-6 rounded-md bg-clay-100 px-3 py-2 text-[11px] leading-relaxed text-clay-700">
              <strong>Sample data:</strong> listings shown are generated examples, not live MLS
              data. Connect an approved IDX feed to display real listings.
            </p>
          )}

          <p className="mt-6 text-xs text-sand-500">
            © {year} {site.agent.name}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

/** Standard HUD Equal Housing Opportunity mark, simplified to an inline SVG. */
function EqualHousingIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7 shrink-0 text-sand-700"
      fill="currentColor"
      role="img"
      aria-label="Equal Housing Opportunity"
    >
      <path d="M12 3 2.5 10.2v1.9h2.2V21h14.6v-8.9h2.2v-1.9L12 3Zm5.6 16.2H6.4v-7.7L12 7.2l5.6 4.3v7.7Z" />
      <path d="M8.6 13.2h6.8v1.5H8.6zm0 2.8h6.8v1.5H8.6z" />
    </svg>
  );
}
