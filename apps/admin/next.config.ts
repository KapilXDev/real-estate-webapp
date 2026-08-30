import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * ⚠️ Every workspace package imported must be listed. These ship raw TypeScript and are
   * compiled by the consumer; an omitted one resolves through the node_modules symlink and
   * happens to work until it doesn't. See the same note in apps/web.
   */
  transpilePackages: ["@tricity/contracts", "@tricity/domain", "@tricity/geo"],

  /*
   * ⚠️ NO `images.remotePatterns` FOR LISTING PHOTOS, AND NO next/image ON THEM.
   *
   * Photos are served by the API at /api/media/:id/:variant, behind an RLS check tied to the
   * caller. Next's image optimizer would fetch them server-side without that session, which for a
   * PRIVATE or DRAFT listing means either broken images or — worse, if the route were ever
   * loosened — an optimizer-shaped hole around the access check. The API already emits correctly
   * sized WebP variants, so there is nothing left for the optimizer to do.
   */
};

export default nextConfig;
