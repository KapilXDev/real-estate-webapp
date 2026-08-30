import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { LISTINGS_TAG } from "@/lib/listings/api-provider";

/**
 * On-demand cache invalidation, called by the admin after any write.
 *
 * ⚠️ WHY THIS EXISTS: listing reads are cached for 60s so crawler traffic does not turn every hit
 * into a spatial query. But that means an agent publishes a listing, switches to the public site,
 * and does not see it — which reads as a failed save rather than a cache. This closes the gap
 * without giving up caching for everyone else.
 *
 * ⚠️ AUTHENTICATION IS A SHARED SECRET, NOT A SESSION. The caller is the admin *server*, not a
 * signed-in human, so there is no cookie to check. Without the secret this is an unauthenticated
 * endpoint that lets anyone dump the cache repeatedly — cheap for them, expensive for us, and a
 * plausible way to make the site slow on demand.
 *
 * It refuses to run at all when the secret is unset, rather than defaulting to open. An
 * environment that forgot to configure it gets a broken revalidate (visible: stale pages) instead
 * of an open one (invisible until abused).
 */
export async function POST(request: Request) {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "REVALIDATE_SECRET is not configured on the site." },
      { status: 503 },
    );
  }

  const provided = request.headers.get("x-revalidate-secret");
  // Length check first so the comparison below cannot be used to probe length.
  if (!provided || provided.length !== expected.length || provided !== expected) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  /*
   * ⚠️ `{ expire: 0 }`, NOT the otherwise-recommended `"max"`.
   *
   * Next 16 requires a profile saying how long stale content may still be served. `"max"` keeps
   * serving the OLD page while it revalidates in the background — which is the right default for
   * a blog, and precisely wrong here: the agent has just published and is refreshing the site to
   * check it worked. Serving them the stale page is the exact behaviour this endpoint exists to
   * eliminate.
   *
   * `{ expire: 0 }` makes the next request a blocking revalidate, so the first person to look
   * after a publish sees the new listing. The cost is one slower request per write, on a site
   * with one writer. Worth it.
   */
  revalidateTag(LISTINGS_TAG, { expire: 0 });
  return NextResponse.json({ revalidated: true, tag: LISTINGS_TAG });
}
