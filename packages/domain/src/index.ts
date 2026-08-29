/**
 * @tricity/domain — pure value objects for the Indian property market.
 *
 * Rules for this package:
 *  - No I/O, no framework imports, no database access. Pure functions and immutable types only.
 *  - Safe to import from the browser, every backend service, and tests alike.
 *  - This is where India-specific correctness lives (INR lakh/crore, marla/kanal areas), so it
 *    is the one place those rules must never be duplicated.
 */

/*
 * Extensionless imports, deliberately. These packages ship raw TypeScript and are compiled by
 * their consumers (Next via transpilePackages, tsx for the API). An explicit ".js" extension is
 * correct for native ESM but Turbopack will not map it back to the ".ts" source, so the build
 * fails with "Can't resolve ./area.js". Extensionless resolves under both.
 */
export * from "./area";
export * from "./money";
