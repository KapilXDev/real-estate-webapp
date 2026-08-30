import type { LocalityRefDto } from "@tricity/contracts";

/**
 * Parse the `area=city/locality` query parameter.
 *
 * ⚠️ WHY THIS IS NOT IMPORTED FROM @tricity/contracts, WHICH DEFINES THE SAME FUNCTION.
 *
 * `apps/api` compiles to CommonJS and the workspace packages ship RAW TYPESCRIPT, compiled by
 * whichever consumer imports them. That works for `apps/web` (Turbopack transpiles it) and for
 * anything run under tsx, but the API's compiled output is plain `require()` calls — and Node
 * cannot require a `.ts` file. Any RUNTIME import of contracts from this app therefore fails at
 * boot with `ERR_MODULE_NOT_FOUND` on an extensionless specifier, long after `tsc` said it was
 * fine. Type-only imports are erased at compile time and are safe; value imports are not.
 *
 * So the rule for this app is: **`import type` from @tricity/contracts, never a value import.**
 *
 * The cost is this four-line duplicate of the contract's own parser, and with it the risk the two
 * silently disagree about the encoding — which is precisely the bug the shared function existed
 * to prevent. That risk is bought back by `catalog-contract.spec.ts`, which imports the REAL
 * `toSearchParams` from contracts (vitest handles TS imports natively) and round-trips its output
 * through the DTO. If the encoder and this parser ever drift, that test fails.
 */
export function parseLocalityRef(raw: string): LocalityRefDto | null {
  const [citySlug, localitySlug, ...rest] = raw.split("/");
  if (!citySlug || !localitySlug || rest.length > 0) return null;
  return { citySlug, localitySlug };
}
