import { cleanupE2EData } from "./db";

/**
 * Remove the rows the run created.
 *
 * ⚠️ Runs even when tests fail, which is the case that matters: a failed publish test leaves a
 * `[E2E]`-titled listing that is PUBLIC and ACTIVE, and the buyer site would then show it to
 * anyone who loads /search. Debugging a failure is better served by the trace and the screenshot
 * than by leftover rows — and `global-setup` re-cleans anyway, so nothing is lost by being tidy.
 */
export default async function globalTeardown(): Promise<void> {
  const removed = await cleanupE2EData();
  const total = Object.values(removed).reduce((a, b) => a + b, 0);
  console.log(
    `[e2e] cleaned up ${total} row(s): ${removed.listings} listings, ${removed.leads} leads, ` +
      `${removed.contacts} contacts, ${removed.reraRegistrations} RERA`,
  );
}
