import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SavedSearchPrompt } from "@/components/leads/SavedSearchPrompt";
import { ListingCard } from "@/components/listings/ListingCard";
import { PROPERTY_TYPE_LABELS, getNeighborhood, neighborhoods } from "@/config/neighborhoods";
import { site } from "@/config/site";
import { formatPrice, formatPriceCompact } from "@/lib/format";
import { getListingProvider } from "@/lib/listings";
import type { MarketStats } from "@/lib/listings/provider";

/**
 * Neighborhood landing page — the highest-leverage SEO asset on the site.
 *
 * ~72% of buyer searches name a specific neighborhood, and the portals rank poorly for those.
 * This page targets "homes for sale in {neighborhood}" and "{neighborhood} {city}" and wins
 * against Zillow by carrying things Zillow structurally cannot: genuine local knowledge, current
 * market stats, and answers to the questions buyers actually ask.
 *
 * The FAQ block is not decoration — Google pulls answers directly from top-ranking local content,
 * so the FAQPage schema below is a real ranking surface.
 *
 * Statically generated per neighborhood, revalidated hourly so the market stats stay current
 * without rebuilding.
 */

export const revalidate = 3600;

export function generateStaticParams() {
  return neighborhoods.map((n) => ({ slug: n.slug }));
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const neighborhood = getNeighborhood(slug);
  if (!neighborhood) return { title: "Neighborhood not found" };

  return {
    // Front-loads the neighborhood name — it's the term people actually search.
    title: `${neighborhood.name} Homes for Sale | ${site.market.city} Neighborhood Guide`,
    description: `${neighborhood.tagline}. Current listings, prices, and a local guide to living in ${neighborhood.name}, ${site.market.city}.`,
    alternates: { canonical: `/neighborhoods/${neighborhood.slug}` },
  };
}

export default async function NeighborhoodPage({ params }: Params) {
  const { slug } = await params;
  const neighborhood = getNeighborhood(slug);
  if (!neighborhood) notFound();

  const provider = getListingProvider();
  const [listings, stats] = await Promise.all([
    provider.getByNeighborhood(slug, 6),
    provider.getMarketStats(slug),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-sand-600">
        <ol className="flex flex-wrap items-center gap-2">
          <li><Link href="/" className="hover:text-brand-700">Home</Link></li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/neighborhoods" className="hover:text-brand-700">Neighborhoods</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-sand-900">{neighborhood.name}</li>
        </ol>
      </nav>

      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold text-sand-950 sm:text-5xl">
          {neighborhood.name}
        </h1>
        <p className="mt-3 text-lg font-medium text-sand-600">{neighborhood.tagline}</p>
        <p className="mt-6 text-lg leading-relaxed text-sand-800">{neighborhood.intro}</p>
      </header>

      {stats && <MarketSnapshot stats={stats} />}

      <div className="mt-12 grid gap-12 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <section>
            <h2 className="font-display text-2xl font-semibold text-sand-950">
              What it&rsquo;s like to live here
            </h2>
            <p className="mt-4 leading-relaxed text-sand-700">{neighborhood.lifestyle}</p>
          </section>

          <section className="mt-10">
            <h2 className="font-display text-2xl font-semibold text-sand-950">
              What defines {neighborhood.name}
            </h2>
            <ul className="mt-4 space-y-3">
              {neighborhood.highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-3 text-sand-700">
                  <span aria-hidden="true" className="mt-1 text-brand-600">◆</span>
                  <span className="leading-relaxed">{highlight}</span>
                </li>
              ))}
            </ul>
          </section>

          {neighborhood.faqs.length > 0 && (
            <section className="mt-10">
              <h2 className="font-display text-2xl font-semibold text-sand-950">
                Common questions about {neighborhood.name}
              </h2>
              <dl className="mt-6 space-y-6">
                {neighborhood.faqs.map((faq) => (
                  <div key={faq.question} className="border-l-2 border-brand-200 pl-5">
                    <dt className="font-semibold text-sand-900">{faq.question}</dt>
                    <dd className="mt-2 leading-relaxed text-sand-700">{faq.answer}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        <aside className="lg:col-span-1">
          <div className="lg:sticky lg:top-24 space-y-4">
            <div className="rounded-card border border-sand-200 bg-white p-6">
              <h2 className="font-display text-lg font-semibold text-sand-950">
                Housing in {neighborhood.name}
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {neighborhood.housingTypes.map((type) => (
                  <li
                    key={type}
                    className="rounded-full bg-sand-100 px-3 py-1 text-xs font-medium text-sand-700"
                  >
                    {PROPERTY_TYPE_LABELS[type]}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-sand-600">
                Typical range{" "}
                <span className="font-semibold text-sand-900">
                  {formatPrice(neighborhood.priceRange.min)} –{" "}
                  {formatPrice(neighborhood.priceRange.max)}
                </span>
              </p>
              <Link
                href={`/search?area=${neighborhood.slug}`}
                className="mt-5 block rounded-md bg-brand-700 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-brand-800"
              >
                Browse all {neighborhood.name} listings
              </Link>
            </div>

            <div className="rounded-card border border-sand-200 bg-sand-100 p-6">
              <h2 className="font-display text-lg font-semibold text-sand-950">
                Thinking about {neighborhood.name}?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-sand-700">
                I can tell you which streets hold value, what recently sold and for how much, and
                what to watch for in these homes specifically.
              </p>
              <Link
                href="/contact"
                className="mt-4 block rounded-md border border-sand-300 bg-white px-4 py-2.5 text-center text-sm font-semibold text-sand-800 hover:border-sand-400"
              >
                Ask me about this area
              </Link>
            </div>
          </div>
        </aside>
      </div>

      {listings.length > 0 && (
        <section className="mt-16 border-t border-sand-200 pt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-display text-2xl font-semibold text-sand-950">
              Homes for sale in {neighborhood.name}
            </h2>
            <Link
              href={`/search?area=${neighborhood.slug}`}
              className="text-sm font-semibold text-brand-700 hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard key={listing.listingKey} listing={listing} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-12">
        <SavedSearchPrompt
          searchDescription={`homes in ${neighborhood.name}`}
          queryString={`area=${neighborhood.slug}`}
        />
      </div>

      <NeighborhoodJsonLd
        name={neighborhood.name}
        description={neighborhood.intro}
        center={neighborhood.center}
        faqs={neighborhood.faqs}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MarketSnapshot({ stats }: { stats: MarketStats }) {
  const items: { label: string; value: string }[] = [
    { label: "Homes for sale", value: String(stats.activeCount) },
    { label: "Median list price", value: formatPriceCompact(stats.medianListPrice) },
    { label: "Median $/sq ft", value: `$${stats.medianPricePerSqft}` },
    { label: "Median days on market", value: String(stats.medianDaysOnMarket) },
  ];

  // Only shown when the sample is large enough to be meaningful — see getMarketStats.
  if (stats.medianClosePrice !== null) {
    items.push({
      label: "Median sale price (90d)",
      value: formatPriceCompact(stats.medianClosePrice),
    });
  }

  return (
    <section className="mt-10 rounded-card border border-sand-200 bg-white p-6">
      <h2 className="font-display text-xl font-semibold text-sand-950">Market snapshot</h2>
      <dl className="mt-5 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-xs uppercase tracking-wide text-sand-500">{item.label}</dt>
            <dd className="mt-1 font-display text-2xl font-semibold text-brand-800">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-sand-500">
        Updated{" "}
        {new Date(stats.generatedAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
        . Figures reflect current inventory and shift with the market.
      </p>
    </section>
  );
}

/**
 * Place + FAQPage structured data.
 *
 * The FAQPage portion is the one most likely to earn a rich result here — Google surfaces
 * answers directly for local queries, which is exactly the traffic this page targets.
 */
function NeighborhoodJsonLd({
  name,
  description,
  center,
  faqs,
}: {
  name: string;
  description: string;
  center: { lat: number; lng: number };
  faqs: { question: string; answer: string }[];
}) {
  const schema = [
    {
      "@context": "https://schema.org",
      "@type": "Place",
      name,
      description,
      address: {
        "@type": "PostalAddress",
        addressLocality: site.market.city,
        addressRegion: site.market.state,
        addressCountry: "US",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: center.lat,
        longitude: center.lng,
      },
    },
    ...(faqs.length > 0
      ? [
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqs.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: { "@type": "Answer", text: faq.answer },
            })),
          },
        ]
      : []),
  ];

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
