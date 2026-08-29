/**
 * @tricity/domain — pure value objects for the Indian property market.
 *
 * Rules for this package:
 *  - No I/O, no framework imports, no database access. Pure functions and immutable types only.
 *  - Safe to import from the browser, every backend service, and tests alike.
 *  - This is where India-specific correctness lives (INR lakh/crore, marla/kanal areas), so it
 *    is the one place those rules must never be duplicated.
 */

export * from "./area.js";
export * from "./money.js";
