import type { MetadataRoute } from "next";

import { neighborhoods } from "@/config/neighborhoods";
import { getListingProvider } from "@/lib/listings";

/**
 * XML sitemap.
 *
 * Priorities reflect what actually drives this business rather than a flat default: neighborhood
 * guides are the pages with a real chance of ranking, so they sit just below the homepage.
 * Listing pages churn constantly, so they get a high change frequency but lower priority — there
 * is no point spending crawl budget re-fetching a listing that will be off-market in three weeks.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/search`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/neighborhoods`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/home-value`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/listings`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/market-reports`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/mortgage-calculator`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];

  const neighborhoodRoutes: MetadataRoute.Sitemap = neighborhoods.map((n) => ({
    url: `${base}/neighborhoods/${n.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.95,
  }));

  // Only for-sale listings. Indexing sold homes wastes crawl budget and frustrates searchers.
  const { listings } = await getListingProvider().search({ pageSize: 100 });
  const listingRoutes: MetadataRoute.Sitemap = listings.map((listing) => ({
    url: `${base}/listings/${listing.listingKey}`,
    lastModified: new Date(listing.modificationTimestamp),
    changeFrequency: "daily",
    priority: 0.7,
  }));

  return [...staticRoutes, ...neighborhoodRoutes, ...listingRoutes];
}
