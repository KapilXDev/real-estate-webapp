import { Area } from "@tricity/domain";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TourRequestForm } from "@/components/leads/TourRequestForm";
import { ListingAttribution } from "@/components/listings/ListingAttribution";
import { ListingCard } from "@/components/listings/ListingCard";
import { EmiCalculator } from "@/components/listings/EmiCalculator";
import { PhotoGallery } from "@/components/listings/PhotoGallery";
import { StatusBadge } from "@/components/listings/StatusBadge";
import { getLocality } from "@/config/localities";
import { site } from "@/config/site";
import {
  formatBaths,
  formatDaysOnMarket,
  formatPrice,
  formatPriceExact,
  formatPricePerSqft,
  formatRelativeTime,
} from "@/lib/format";
import { getListingProvider } from "@/lib/listings";
import {
  FURNISHING_LABELS,
  POSSESSION_LABELS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_SHORT,
  comparableSqft,
  isLandType,
  type Listing,
  type StoredArea,
} from "@/lib/listings/types";

/**
 * Property detail page — the deepest point of buyer intent on the site.
 *
 * Everything is oriented around converting an interested viewer into a site visit: the visit CTA
 * stays reachable through a long scroll (sticky sidebar), the EMI estimate removes the "can I
 * actually afford this?" blocker, and the locality link routes buyers deeper into the hyperlocal
 * content rather than back out to a portal.
 */

type Params = { params: Promise<{ listingKey: string }> };

/** Render a stored area with the factor it was written with — "10 marla (2,723 sq ft)". */
function areaFull(area: StoredArea): string {
  return Area.fromStored(
    area.inputValue,
    area.inputUnit,
    area.sqft,
    area.conversionFactor,
  ).formatWithSqft();
}

/** Headline descriptor: "3 BHK Flat" or "10 Marla Plot". */
function headline(listing: Listing): string {
  const type = PROPERTY_TYPE_SHORT[listing.propertyType];
  if (isLandType(listing.propertyType)) {
    const size = listing.plotArea
      ? Area.fromStored(
          listing.plotArea.inputValue,
          listing.plotArea.inputUnit,
          listing.plotArea.sqft,
          listing.plotArea.conversionFactor,
        ).format()
      : "";
    return size ? `${size} ${type}` : type;
  }
  return listing.bedroomsTotal ? `${listing.bedroomsTotal} BHK ${type}` : type;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { listingKey } = await params;
  const listing = await getListingProvider().getByKey(listingKey);
  if (!listing) return { title: "Listing not found" };

  const price = listing.priceOnRequest ? "Price on request" : formatPrice(listing.listPrice);
  const title = `${headline(listing)} in ${listing.address.line1}, ${listing.address.city} — ${price}`;
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

  const locality = getLocality(listing.citySlug, listing.localitySlug);
  const nearby = (
    await provider.getByLocality(
      { citySlug: listing.citySlug, localitySlug: listing.localitySlug },
      5,
    )
  ).filter((l) => l.listingKey !== listing.listingKey);

  const isSold = listing.status === "Sold";
  const displayPrice = isSold && listing.closePrice ? listing.closePrice : listing.listPrice;
  const showPrice = !listing.priceOnRequest || isSold;
  const sqft = comparableSqft(listing);

  // Only localities with hand-written content have a landing page to link to.
  const localityHref = locality?.content
    ? `/localities/${listing.citySlug}/${listing.localitySlug}`
    : null;

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
          {locality && (
            <>
              <li aria-hidden="true">/</li>
              <li>
                {localityHref ? (
                  <Link href={localityHref} className="hover:text-brand-700">
                    {locality.name}, {locality.cityName}
                  </Link>
                ) : (
                  <span>
                    {locality.name}, {locality.cityName}
                  </span>
                )}
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
            {/* Our own reference, not an industry identifier — there is no MLS number here. */}
            <span className="text-sm text-sand-600">Ref. {listing.referenceCode}</span>
          </div>

          <h1 className="mt-4 font-display text-4xl font-semibold text-sand-950">
            {showPrice ? formatPrice(displayPrice) : "Price on request"}
          </h1>
          {showPrice && (
            <p className="mt-1 text-sm text-sand-600">{formatPriceExact(displayPrice)}</p>
          )}
          <p className="mt-2 text-lg text-sand-700">
            {headline(listing)} · {listing.address.unparsed}
          </p>

          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-y border-sand-200 py-4">
            {listing.bedroomsTotal !== undefined && (
              <Stat label="Bedrooms" value={`${listing.bedroomsTotal} BHK`} />
            )}
            {listing.bathroomsTotal !== undefined && (
              <Stat label="Bathrooms" value={formatBaths(listing.bathroomsTotal)} />
            )}
            {listing.carpetArea && (
              <Stat label="Carpet area" value={areaFull(listing.carpetArea)} />
            )}
            {listing.builtUpArea && (
              <Stat label="Built-up area" value={areaFull(listing.builtUpArea)} />
            )}
            {listing.plotArea && (
              <Stat label="Plot area" value={areaFull(listing.plotArea)} />
            )}
            {showPrice && sqft > 0 && (
              <Stat label="Rate" value={formatPricePerSqft(displayPrice, sqft)} />
            )}
            <Stat label="Possession" value={POSSESSION_LABELS[listing.possession]} />
          </div>

          <section className="mt-8">
            <h2 className="font-display text-2xl font-semibold text-sand-950">
              About this property
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

          {locality?.content && (
            <section className="mt-8 rounded-card border border-sand-200 bg-sand-100 p-6">
              <h2 className="font-display text-2xl font-semibold text-sand-950">
                About {locality.name}, {locality.cityName}
              </h2>
              <p className="mt-3 leading-relaxed text-sand-700">
                {locality.content.lifestyle}
              </p>
              {localityHref && (
                <Link
                  href={localityHref}
                  className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline"
                >
                  Read the full {locality.name} guide →
                </Link>
              )}
            </section>
          )}

          <div className="mt-8">
            <EmiCalculator
              propertyPrice={displayPrice}
              monthlyMaintenance={listing.maintenanceCharges}
              annualPropertyTax={listing.propertyTaxAnnual}
              state={listing.address.state}
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
              {/* WhatsApp is the dominant channel here — give it equal billing with the phone. */}
              <a
                href={`https://wa.me/${site.agent.whatsapp}?text=${encodeURIComponent(
                  `Hi, I'm interested in ${listing.address.unparsed} (Ref. ${listing.referenceCode}).`,
                )}`}
                className="mt-1 block text-sm font-medium text-brand-700 hover:underline"
              >
                Message on WhatsApp
              </a>
              <ListingAttribution
                listing={listing}
                className="mt-4 border-t border-sand-100 pt-3"
              />
              <p className="mt-2 text-[11px] text-sand-500">
                Listing updated {formatRelativeTime(listing.modificationTimestamp)}.
              </p>
            </div>
          </div>
        </aside>
      </div>

      {nearby.length > 0 && (
        <section className="mt-16 border-t border-sand-200 pt-10">
          <h2 className="font-display text-2xl font-semibold text-sand-950">
            More in {locality ? `${locality.name}, ${locality.cityName}` : "this area"}
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
    ["Possession", POSSESSION_LABELS[listing.possession]],
  ];

  if (listing.possessionDate) {
    facts.push([
      "Expected possession",
      new Date(listing.possessionDate).toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric",
      }),
    ]);
  }
  if (listing.yearBuilt) facts.push(["Year built", String(listing.yearBuilt)]);
  if (listing.carpetArea) facts.push(["Carpet area", areaFull(listing.carpetArea)]);
  if (listing.builtUpArea) facts.push(["Built-up area", areaFull(listing.builtUpArea)]);
  if (listing.plotArea) facts.push(["Plot area", areaFull(listing.plotArea)]);
  if (listing.floor !== undefined && listing.totalFloors !== undefined) {
    facts.push([
      "Floor",
      `${listing.floor === 0 ? "Ground" : listing.floor} of ${listing.totalFloors}`,
    ]);
  }
  if (listing.furnishing) facts.push(["Furnishing", FURNISHING_LABELS[listing.furnishing]]);
  if (listing.facing) {
    facts.push([
      "Facing",
      listing.facing.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    ]);
  }
  if (listing.balconies !== undefined) facts.push(["Balconies", String(listing.balconies)]);
  if (listing.maintenanceCharges) {
    facts.push(["Society maintenance", `${formatPriceExact(listing.maintenanceCharges)}/month`]);
  }
  if (listing.propertyTaxAnnual) {
    facts.push(["Property tax", `${formatPriceExact(listing.propertyTaxAnnual)}/year`]);
  }
  if (listing.reraProjectRegistration) {
    facts.push(["Project RERA", listing.reraProjectRegistration]);
  }
  facts.push(["Reference", listing.referenceCode], ["PIN code", listing.address.pincode]);

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
 * Google reliably surfaces rich results for property, and listing pages are the highest-volume
 * page type on this site — worth getting right rather than treating as optional SEO garnish.
 *
 * Type is chosen from the property type rather than hardcoded: the old build emitted
 * SingleFamilyResidence for everything, which is simply wrong for a plot or an SCO and risks the
 * markup being ignored or flagged.
 */
function PropertyJsonLd({ listing }: { listing: Listing }) {
  const schemaType = isLandType(listing.propertyType)
    ? "Place"
    : listing.propertyType === "flat"
      ? "Apartment"
      : "SingleFamilyResidence";

  const sqft = comparableSqft(listing);

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": schemaType,
    name: `${headline(listing)} in ${listing.address.line1}, ${listing.address.city}`,
    description: listing.publicRemarks,
    address: {
      "@type": "PostalAddress",
      streetAddress: [listing.address.houseNumber, listing.address.line1]
        .filter(Boolean)
        .join(", "),
      addressLocality: listing.address.city,
      addressRegion: listing.address.state,
      postalCode: listing.address.pincode,
      addressCountry: "IN",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: listing.coordinates.lat,
      longitude: listing.coordinates.lng,
    },
    photo: listing.media.map((m) => m.url),
  };

  if (listing.bedroomsTotal !== undefined) schema.numberOfRooms = listing.bedroomsTotal;
  if (listing.bathroomsTotal !== undefined) {
    schema.numberOfBathroomsTotal = listing.bathroomsTotal;
  }
  if (listing.yearBuilt) schema.yearBuilt = listing.yearBuilt;
  if (sqft > 0) {
    // FTK is the UN/CEFACT code for square foot. Areas are stored canonically in sq ft even
    // where they were entered in marla, so this stays consistent.
    schema.floorSize = { "@type": "QuantitativeValue", value: sqft, unitCode: "FTK" };
  }

  // Only advertise a price when the seller has published one.
  if (!listing.priceOnRequest) {
    schema.offers = {
      "@type": "Offer",
      price: listing.listPrice,
      priceCurrency: "INR",
      availability:
        listing.status === "Active"
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
    };
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
