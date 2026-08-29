/**
 * @tricity/geo — the canonical list of places this platform covers.
 *
 * WHY THIS IS A SHARED PACKAGE, not seed data inside the API:
 * the database and the website must never disagree about which sectors exist. If the seed says
 * Mohali has Sectors 66-91 and the website's dropdown says 66-95, buyers get filters that return
 * nothing and the bug is invisible until someone complains. One list, imported by both.
 *
 * Rules for this package (same as @tricity/domain):
 *  - No I/O, no framework imports, no database access. Pure data and pure functions.
 *  - Safe to import from the browser, every backend service, and tests alike.
 *
 * This package owns FACTS about places (name, slug, kind, city, coordinates). It deliberately
 * does NOT own editorial copy — the marketing prose for a locality landing page lives with the
 * consumer that renders it, because it is written per-locality by hand and only a fraction of the
 * 102 localities will ever have it.
 */

/* Extensionless import — see the note in @tricity/domain's index.ts for why. */
export * from "./tricity";
