import type { MetadataRoute } from "next";

import { citiesWithContent, localitiesWithContent } from "@/config/localities";
import { getListingProvider } from "@/lib/listings";

/**
 * XML sitemap.
 *
 * Priorities reflect what actually drives this business rather than a flat default: locality
 * guides are the pages with a real chance of ranking, so they sit just below the homepage.
 * Listing pages churn constantly, so they get a high change frequency but lower priority — there
 * is no point spending crawl budget re-fetching a listing that will be off-market in three weeks.
 *
 * ⚠️ ONLY LOCALITIES WITH EDITORIAL CONTENT ARE LISTED. Submitting 102 templated locality URLs
 * would be asking Google to crawl and judge 94 thin pages, which costs crawl budget and invites a
 * doorway-page assessment. The sitemap should advertise the pages worth ranking, not every route
 * that resolves.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/search`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/localities`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/home-value`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/listings`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/market-reports`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    {
      url: `${base}/home-loan-calculator`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  // City hubs sit between the index and the locality guides in the link hierarchy.
  const cityRoutes: MetadataRoute.Sitemap = citiesWithContent().map((citySlug) => ({
    url: `${base}/localities/${citySlug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.85,
  }));

  const localityRoutes: MetadataRoute.Sitemap = localitiesWithContent().map((locality) => ({
    url: `${base}/localities/${locality.citySlug}/${locality.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.95,
  }));

  // Only for-sale listings. Indexing sold properties wastes crawl budget and frustrates searchers.
  const { listings } = await getListingProvider().search({ pageSize: 100 });
  const listingRoutes: MetadataRoute.Sitemap = listings.map((listing) => ({
    url: `${base}/listings/${listing.listingKey}`,
    lastModified: new Date(listing.modificationTimestamp),
    changeFrequency: "daily",
    priority: 0.7,
  }));

  return [...staticRoutes, ...cityRoutes, ...localityRoutes, ...listingRoutes];
}
