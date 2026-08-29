import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TourRequestForm } from "@/components/leads/TourRequestForm";
import { ListingAttribution } from "@/components/listings/ListingAttribution";
import { ListingCard } from "@/components/listings/ListingCard";
import { MortgageCalculator } from "@/components/listings/MortgageCalculator";
import { PhotoGallery } from "@/components/listings/PhotoGallery";
import { StatusBadge } from "@/components/listings/StatusBadge";
import { PROPERTY_TYPE_LABELS, getNeighborhood } from "@/config/neighborhoods";
import { site } from "@/config/site";
import {
  formatBaths,
  formatDaysOnMarket,
  formatLotSize,
  formatPrice,
  formatPricePerSqft,
  formatRelativeTime,
  formatSqft,
} from "@/lib/format";
import { getListingProvider } from "@/lib/listings";
import type { Listing } from "@/lib/listings/types";

/**
 * Property detail page — the deepest point of buyer intent on the site.
 *
 * Everything is oriented around converting an interested viewer into a showing request: the tour
 * CTA stays reachable through a long scroll (sticky sidebar), the mortgage estimate removes the
 * "can I actually afford this?" blocker, and the neighborhood link routes buyers deeper into the
 * hyperlocal content rather than back out to a portal.
 */

type Params = { params: Promise<{ listingKey: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { listingKey } = await params;
  const listing = await getListingProvider().getByKey(listingKey);
  if (!listing) return { title: "Listing not found" };

  const title = `${listing.bedroomsTotal} Bed, ${formatBaths(listing.bathroomsTotal)} Bath in ${listing.address.city} — ${formatPrice(listing.listPrice)}`;
  const description = listing.publicRemarks.slice(0, 155);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: listing.media[0] ? [{ url: listing.media[0].url }] : undefined,
    },
  };
}

export default async function ListingPage({ params }: Params) {
  const { listingKey } = await params;
  const provider = getListingProvider();
  const listing = await provider.getByKey(listingKey);

  if (!listing) notFound();

  const neighborhood = getNeighborhood(listing.neighborhoodSlug);
  const nearby = (await provider.getByNeighborhood(listing.neighborhoodSlug, 5)).filter(
    (l) => l.listingKey !== listing.listingKey,
  );

  const isSold = listing.status === "Closed";
  const displayPrice = isSold && listing.closePrice ? listing.closePrice : listing.listPrice;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-sand-600">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:text-brand-700">Home</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/search" className="hover:text-brand-700">Search</Link>
          </li>
          {neighborhood && (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  href={`/neighborhoods/${neighborhood.slug}`}
                  className="hover:text-brand-700"
                >
                  {neighborhood.name}
                </Link>
              </li>
            </>
          )}
          <li aria-hidden="true">/</li>
          <li className="text-sand-900">{listing.address.unparsed}</li>
        </ol>
      </nav>

      <PhotoGallery media={listing.media} />

      <div className="mt-10 grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={listing.status} />
            <span className="text-sm text-sand-600">
              {formatDaysOnMarket(listing.daysOnMarket)}
            </span>
            <span aria-hidden="true" className="text-sand-300">·</span>
            <span className="text-sm text-sand-600">MLS# {listing.mlsNumber}</span>
          </div>

          <h1 className="mt-4 font-display text-4xl font-semibold text-sand-950">
            {formatPrice(displayPrice)}
          </h1>
          <p className="mt-2 text-lg text-sand-700">{listing.address.unparsed}</p>

          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-y border-sand-200 py-4">
            <Stat label="Bedrooms" value={String(listing.bedroomsTotal)} />
            <Stat label="Bathrooms" value={formatBaths(listing.bathroomsTotal)} />
            <Stat label="Interior" value={formatSqft(listing.livingArea)} />
            <Stat
              label="Price / sq ft"
              value={formatPricePerSqft(displayPrice, listing.livingArea)}
            />
            {listing.lotSizeSquareFeet && (
              <Stat label="Lot" value={formatLotSize(listing.lotSizeSquareFeet)} />
            )}
          </div>

          <section className="mt-8">
            <h2 className="font-display text-2xl font-semibold text-sand-950">
              About this home
            </h2>
            <p className="mt-3 leading-relaxed text-sand-700">{listing.publicRemarks}</p>
          </section>

          {listing.features.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-2xl font-semibold text-sand-950">Features</h2>
              <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                {listing.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-sand-700">
                    <span aria-hidden="true" className="mt-0.5 text-brand-600">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <PropertyFacts listing={listing} />

          {neighborhood && (
            <section className="mt-8 rounded-card border border-sand-200 bg-sand-100 p-6">
              <h2 className="font-display text-2xl font-semibold text-sand-950">
                About {neighborhood.name}
              </h2>
              <p className="mt-3 leading-relaxed text-sand-700">{neighborhood.lifestyle}</p>
              <Link
                href={`/neighborhoods/${neighborhood.slug}`}
                className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline"
              >
                Read the full {neighborhood.name} guide →
              </Link>
            </section>
          )}

          <div className="mt-8">
            <MortgageCalculator
              homePrice={displayPrice}
              annualTax={listing.taxAnnualAmount}
              monthlyHoa={listing.associationFee}
            />
          </div>
        </div>

        <aside className="lg:col-span-1">
          {/* Sticky so the conversion path stays reachable through a long scroll. */}
          <div className="lg:sticky lg:top-24">
            <TourRequestForm listing={listing} />

            <div className="mt-4 rounded-card border border-sand-200 bg-white p-5">
              <p className="text-sm font-semibold text-sand-900">{site.agent.name}</p>
              <p className="text-sm text-sand-600">{site.agent.title}</p>
              <a
                href={`tel:${site.agent.phone.replace(/[^\d+]/g, "")}`}
                className="mt-3 block text-sm font-medium text-brand-700 hover:underline"
              >
                {site.agent.phone}
              </a>
              <ListingAttribution
                listing={listing}
                className="mt-4 border-t border-sand-100 pt-3"
              />
              <p className="mt-2 text-[11px] text-sand-500">
                Listing data updated {formatRelativeTime(listing.modificationTimestamp)}.
              </p>
            </div>
          </div>
        </aside>
      </div>

      {nearby.length > 0 && (
        <section className="mt-16 border-t border-sand-200 pt-10">
          <h2 className="font-display text-2xl font-semibold text-sand-950">
            More homes in {neighborhood?.name ?? "this area"}
          </h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {nearby.slice(0, 4).map((l) => (
              <ListingCard key={l.listingKey} listing={l} />
            ))}
          </div>
        </section>
      )}

      <PropertyJsonLd listing={listing} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-sand-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-sand-900">{value}</p>
    </div>
  );
}

function PropertyFacts({ listing }: { listing: Listing }) {
  const facts: [string, string][] = [
    ["Property type", PROPERTY_TYPE_LABELS[listing.propertyType]],
    ["Year built", String(listing.yearBuilt)],
    ["Interior", formatSqft(listing.livingArea)],
  ];

  if (listing.lotSizeSquareFeet) {
    facts.push(["Lot size", formatLotSize(listing.lotSizeSquareFeet)]);
  }
  if (listing.associationFee) {
    facts.push(["HOA dues", `${formatPrice(listing.associationFee)}/mo`]);
  }
  if (listing.taxAnnualAmount) {
    facts.push(["Annual tax", formatPrice(listing.taxAnnualAmount)]);
  }
  facts.push(["MLS number", listing.mlsNumber], ["Postal code", listing.address.postalCode]);

  return (
    <section className="mt-8">
      <h2 className="font-display text-2xl font-semibold text-sand-950">Property details</h2>
      <dl className="mt-4 grid gap-x-8 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between gap-4 border-b border-sand-100 py-2.5 text-sm"
          >
            <dt className="text-sand-600">{label}</dt>
            <dd className="font-medium text-sand-900">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * schema.org structured data.
 *
 * Real estate is a vertical where Google reliably surfaces rich results, and listing pages are
 * the highest-volume page type on this site — worth getting right rather than treating as
 * optional SEO garnish.
 */
function PropertyJsonLd({ listing }: { listing: Listing }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "SingleFamilyResidence",
    name: listing.address.unparsed,
    description: listing.publicRemarks,
    numberOfRooms: listing.bedroomsTotal,
    numberOfBathroomsTotal: listing.bathroomsTotal,
    yearBuilt: listing.yearBuilt,
    floorSize: {
      "@type": "QuantitativeValue",
      value: listing.livingArea,
      unitCode: "FTK",
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: `${listing.address.streetNumber} ${listing.address.streetName}`,
      addressLocality: listing.address.city,
      addressRegion: listing.address.stateOrProvince,
      postalCode: listing.address.postalCode,
      addressCountry: "US",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: listing.coordinates.lat,
      longitude: listing.coordinates.lng,
    },
    photo: listing.media.map((m) => m.url),
    offers: {
      "@type": "Offer",
      price: listing.listPrice,
      priceCurrency: "USD",
      availability:
        listing.status === "Active"
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
