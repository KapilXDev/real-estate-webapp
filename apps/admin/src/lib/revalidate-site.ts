/**
 * Tell the public site to drop its listing cache.
 *
 * ⚠️ FIRE-AND-FORGET BY DESIGN. If the site is unreachable, or the secret is wrong, the agent's
 * save has ALREADY SUCCEEDED — the listing is in the database. Failing the admin action because a
 * cache hint did not land would turn a cosmetic delay into a lost edit, which is strictly worse.
 * The failure degrades to what the behaviour was before: the page catches up within 60 seconds.
 *
 * Logged rather than thrown so a persistently broken hook is visible in the admin's logs instead
 * of silently reverting everyone to stale pages.
 */
export async function revalidateSite(): Promise<void> {
  const url = process.env.SITE_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;

  if (!url || !secret) {
    // Not configured is a normal local setup, not an error — say so once, quietly.
    return;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
      cache: "no-store",
      // The admin must not hang on a slow or wedged site. A missed revalidation costs 60 seconds
      // of staleness; a hung server action costs the agent their afternoon.
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      console.warn(`[revalidateSite] site returned ${response.status}`);
    }
  } catch (error) {
    console.warn(
      `[revalidateSite] could not reach the site: ${error instanceof Error ? error.message : error}`,
    );
  }
}
