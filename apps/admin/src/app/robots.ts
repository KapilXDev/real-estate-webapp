import type { MetadataRoute } from "next";

/**
 * ⚠️ UNCONDITIONAL. Unlike apps/web, this does NOT depend on NEXT_PUBLIC_SITE_URL.
 *
 * An admin app has nothing a search engine should ever see, and the login page in particular
 * should not be discoverable. There is no environment in which indexing this is correct, so there
 * is no branch that could accidentally allow it.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
