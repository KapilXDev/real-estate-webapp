import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCity, localitiesInCity } from "@tricity/geo";

import { ListingCard } from "@/components/listings/ListingCard";
import { citiesWithContent, getLocalityContent } from "@/config/localities";
import { formatPriceCompact } from "@/lib/format";
import { getListingProvider } from "@/lib/listings";

/**
 * City hub page — the middle tier of the link hierarchy.
 *
 *   /localities  →  /localities/mohali  →  /localities/mohali/sector-70
 *
 * This tier exists because "property in Mohali" is a real search with real volume that sits
 * between the region-level term (too competitive) and the sector-level term (highest intent but
 * lowest volume). It also gives the sector guides a topically-relevant parent to be linked from,
 * which is worth more than linking them all from a single flat index.
 *
 * Every locality in the city is listed, whether or not it has a guide written — but only the ones
 * with content are linked to a page. The rest link into search, which is honest about what exists
 * and still captures the long-tail term.
 */

export const revalidate = 3600;

export function generateStaticParams() {
  return citiesWithContent().map((city) => ({ city }));
}

type Params = { params: Promise<{ city: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { city: citySlug } = await params;
  const city = getCity(citySlug);
  if (!city) return { title: "City not found" };

  return {
    title: `Property for Sale in ${city.name} | Sectors, Phases & Areas`,
    description:
      `Browse property for sale across every sector and phase in ${city.name}, ${city.state}. ` +
      `Local area guides, current listings and asking prices.`,
    alternates: { canonical: `/localities/${city.slug}` },
  };
}

export default async function CityPage({ params }: Params) {
  const { city: citySlug } = await params;
  const city = getCity(citySlug);
  if (!city) notFound();

  const provider = getListingProvider();
  const [listings, localities] = await Promise.all([
    provider.getByCity(citySlug, 6),
    Promise.resolve(localitiesInCity(citySlug)),
  ]);

  // Sort numbered localities numerically — "Sector 10" must not sort between 1 and 2.
  const sorted = [...localities].sort((a, b) => {
    const na = Number(a.name.replace(/\D/g, ""));
    const nb = Number(b.name.replace(/\D/g, ""));
    if (Number.isFinite(na) && Number.isFinite(nb) && na && nb) return na - nb;
    return a.name.localeCompare(b.name);
  });

  const guides = sorted.filter((l) => getLocalityContent(citySlug, l.slug));

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-sand-600">
        <ol className="flex flex-wrap items-center gap-2">
          <li><Link href="/" className="hover:text-brand-700">Home</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/localities" className="hover:text-brand-700">Areas</Link></li>
          <li aria-hidden="true">/</li>
          <li className="text-sand-900">{city.name}</li>
        </ol>
      </nav>

      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold text-sand-950 sm:text-5xl">
          Property for sale in {city.name}
        </h1>
        <p className="mt-3 text-lg text-sand-600">{city.state}</p>
        <p className="mt-6 text-lg leading-relaxed text-sand-800">
          {sorted.length} areas across {city.name}, from established sectors to newer
          developments. Pick an area below, or search across all of them at once.
        </p>
      </header>

      {guides.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-sand-950">Area guides</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {guides.map((locality) => {
              const content = getLocalityContent(citySlug, locality.slug)!;
              return (
                <article
                  key={locality.slug}
                  className="rounded-card border border-sand-200 bg-white p-5 transition-shadow hover:shadow-md"
                >
                  <h3 className="font-display text-xl font-semibold text-sand-950">
                    <Link
                      href={`/localities/${citySlug}/${locality.slug}`}
                      className="hover:text-brand-700"
                    >
                      {locality.name}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm text-sand-600">{content.tagline}</p>
                  <p className="mt-3 text-sm font-medium text-sand-800">
                    {formatPriceCompact(content.priceRange.min)}–
                    {formatPriceCompact(content.priceRange.max)}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/*
       * The full list. Areas without a guide still get a search link — the sector name is what
       * buyers type, so capturing that query matters even before the guide is written.
       */}
      <section className="mt-14">
        <h2 className="font-display text-2xl font-semibold text-sand-950">
          All areas in {city.name}
        </h2>
        <ul className="mt-6 flex flex-wrap gap-2">
          {sorted.map((locality) => {
            const hasGuide = getLocalityContent(citySlug, locality.slug) !== undefined;
            return (
              <li key={locality.slug}>
                <Link
                  href={
                    hasGuide
                      ? `/localities/${citySlug}/${locality.slug}`
                      : `/search?area=${citySlug}/${locality.slug}`
                  }
                  className={
                    hasGuide
                      ? "inline-block rounded-full border border-brand-200 bg-brand-50 px-3.5 py-1.5 text-sm font-medium text-brand-800 hover:border-brand-300"
                      : "inline-block rounded-full border border-sand-200 px-3.5 py-1.5 text-sm text-sand-700 hover:border-sand-400"
                  }
                >
                  {locality.name}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-sm text-sand-500">
          Highlighted areas have a full guide. The rest link straight to current listings.
        </p>
      </section>

      {listings.length > 0 && (
        <section className="mt-16 border-t border-sand-200 pt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 className="font-display text-2xl font-semibold text-sand-950">
              Latest in {city.name}
            </h2>
            <Link
              href={`/search?city=${citySlug}`}
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
    </div>
  );
}
