/**
 * Cookie names, and nothing else.
 *
 * ⚠️ A separate module with ZERO imports on purpose. `proxy.ts` needs these names, but it runs in
 * a restricted runtime that may be deployed to a CDN edge — the Next docs are explicit that proxy
 * "should not attempt relying on shared modules or globals". Importing them from `session.ts`
 * would drag in `next/headers`, which does not exist there, and the failure would surface as an
 * opaque runtime error on every request rather than as a build error.
 */
export const SESSION_COOKIE_NAMES = {
  access: "tricity_access",
  refresh: "tricity_refresh",
} as const;
