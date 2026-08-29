import Link from "next/link";

import { localitiesWithContent } from "@/config/localities";
import { site } from "@/config/site";
import { getListingProvider } from "@/lib/listings";

/**
 * Site footer, including the required compliance block.
 *
 * ⚠️ THE COMPLIANCE BLOCK IS NOT DECORATIVE. Do not remove it to tidy the design.
 *
 * Replaced the US block (Equal Housing Opportunity mark, DRE license numbers, MLS disclaimer)
 * with the Indian equivalent. What RERA requires is the agent's registration number in all
 * advertising — and because the tricity spans two jurisdictions, BOTH registrations are listed:
 * Punjab RERA for Mohali/Kharar/Zirakpur/New Chandigarh, and Chandigarh's own UT authority.
 *
 * There is no fair-housing logo requirement in India and no MLS board disclaimer, because there
 * is no MLS. The data disclaimer that replaces it says something true about where listing
 * information comes from rather than imitating American legalese.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const isLive = getListingProvider().isLiveData;
  const featured = localitiesWithContent();
  const jurisdictions = Object.values(site.rera.byState);

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
              <li><Link href="/localities" className="text-sand-700 hover:text-brand-700">Area Guides</Link></li>
              <li><Link href="/home-loan-calculator" className="text-sand-700 hover:text-brand-700">Home Loan Calculator</Link></li>
            </ul>
          </div>

          <div>
            <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-sand-900">
              Selling
            </h2>
            <ul className="mt-4 space-y-2 text-sm">
              <li><Link href="/home-value" className="text-sand-700 hover:text-brand-700">What&rsquo;s My Property Worth?</Link></li>
              <li><Link href="/market-reports" className="text-sand-700 hover:text-brand-700">Market Reports</Link></li>
              <li><Link href="/contact" className="text-sand-700 hover:text-brand-700">Request a Consultation</Link></li>
            </ul>
          </div>

          <div>
            <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-sand-900">
              Areas
            </h2>
            {/* Footer links to locality pages help Google discover and weight them. */}
            <ul className="mt-4 space-y-2 text-sm">
              {featured.slice(0, 6).map((l) => (
                <li key={`${l.citySlug}/${l.slug}`}>
                  <Link
                    href={`/localities/${l.citySlug}/${l.slug}`}
                    className="text-sand-700 hover:text-brand-700"
                  >
                    {l.name}, {l.cityName}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---- Compliance block. Required under RERA. Do not remove. ---- */}
        <div className="mt-12 border-t border-sand-300 pt-8">
          <div className="space-y-1 text-xs leading-relaxed text-sand-600">
            <p>
              {site.agent.name}, {site.agent.title}
            </p>
            <p>
              {site.firm.name} · {site.firm.address}
            </p>
          </div>

          {/*
           * RERA registrations, one per jurisdiction the agent operates in. Chandigarh is a
           * Union Territory with its own authority, so a Punjab registration does not cover it —
           * both must be shown, not just a default.
           */}
          <div className="mt-4 space-y-1 text-xs leading-relaxed text-sand-600">
            {jurisdictions.map((j) => (
              <p key={j.registration}>
                <span className="font-medium text-sand-700">{j.shortName}</span> Reg. No.{" "}
                {j.registration}
              </p>
            ))}
          </div>

          {isLive ? (
            <p className="mt-6 text-[11px] leading-relaxed text-sand-500">
              {site.compliance.dataDisclaimer}
            </p>
          ) : (
            /* Dev-only notice. Disappears automatically once a live provider is configured. */
            <p className="mt-6 rounded-md bg-clay-100 px-3 py-2 text-[11px] leading-relaxed text-clay-700">
              <strong>Sample data:</strong> the properties shown are generated examples, not real
              inventory. Prices, areas and registration numbers are placeholders.
            </p>
          )}

          <p className="mt-6 text-xs text-sand-500">
            © {year} {site.compliance.copyrightHolder}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
