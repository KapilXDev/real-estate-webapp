/**
 * @tricity/contracts — the wire format shared between the frontend and every backend service.
 *
 * This package is the reason the stack is TypeScript end to end: request/response shapes are
 * defined ONCE and imported by both sides, so client and server cannot drift. There is no
 * OpenAPI codegen step to forget to run.
 *
 * Rules:
 *  - MUST stay dependency-free (zod is the only permitted exception) so the browser can import it.
 *  - Types AND runtime validators live here — the server validates inbound, the client can
 *    validate outbound, from the same source of truth.
 *  - Never import from @tricity/domain here; contracts describe the wire, domain describes
 *    behaviour. Keeping them separate stops framework concerns leaking into the browser bundle.
 */

// Extensionless specifiers on purpose: these packages ship raw TS and are compiled by the
// consumer. A `.js` specifier would not resolve back to the source under Turbopack.
export * from "./catalog";
export * from "./leads";

