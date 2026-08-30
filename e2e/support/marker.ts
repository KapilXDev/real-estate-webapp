/**
 * The marker every row these tests create must carry.
 *
 * ⚠️ THIS IS THE ONLY THING STANDING BETWEEN THE CLEANUP AND THE AGENT'S REAL INVENTORY. The
 * tests run against the dev database (see the note in `env.ts`), so teardown deletes by matching
 * this prefix — exactly the approach `seed/demo-listings.ts` takes with `[SAMPLE]`. A listing
 * created without it will survive the run and quietly appear on the public site; a DELETE written
 * without it could remove real work.
 *
 * It is a visible prefix rather than a hidden column so that a row left behind by a crashed run
 * is obvious in the admin UI, not something only the database knows about.
 */
export const E2E_PREFIX = "[E2E]";

/** Contact emails the lead tests create. Kept on its own domain, reserved by RFC 2606. */
export const E2E_EMAIL_DOMAIN = "e2e.invalid";

/**
 * A label unique to one test, so parallel workers cannot see each other's rows.
 *
 * Two workers both creating "[E2E] kothi" and then both searching for it is a flake that only
 * appears under load, which is the worst kind to debug.
 */
export function uniqueTitle(what: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${E2E_PREFIX} ${what} ${suffix}`;
}

export function uniqueEmail(what: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${what}-${suffix}@${E2E_EMAIL_DOMAIN}`;
}

/**
 * A phone number for a test buyer.
 *
 * ⚠️ MUST BE UNIQUE PER RUN, and this is not cosmetic. `LeadRepository` matches an incoming
 * enquiry to an existing contact BY PHONE FIRST, email second — WhatsApp is the dominant channel
 * here, so the phone is the stronger identity. A hardcoded number therefore attaches the test's
 * enquiry to whoever already owns it (during development that was a real contact created by hand
 * testing), the test's own email never gets stored, and the teardown — which keys on the e2e
 * email domain — cannot find the lead to remove it. The test fails AND leaves a row in the
 * agent's queue.
 *
 * Indian mobile numbers begin 6-9; this stays inside that range and randomises the last five
 * digits.
 */
export function uniquePhone(): string {
  /* ⚠️ EXACTLY TEN DIGITS after +91. The API validates this ("Enter a valid Indian mobile
   * number"), and a nine-digit number is rejected with a 400 that the site turns into a generic
   * 500 — so the test failed at the buyer's confirmation screen, pointing at the form rather than
   * at the number. "98" keeps it in the 6-9 range Indian mobiles start with. */
  const suffix = String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0");
  return `+9198${suffix}`;
}
