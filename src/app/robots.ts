import type { MetadataRoute } from "next";

/**
 * robots.txt
 *
 * While NEXT_PUBLIC_SITE_URL is unset the site is running on sample data, so everything is
 * disallowed — letting a search engine index fabricated listings as though they were real MLS
 * inventory would be both an accuracy and an IDX compliance problem.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL;

  if (!base) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // No ranking value, and filtered permutations would burn crawl budget endlessly.
        disallow: ["/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
