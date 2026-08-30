import { cookies } from "next/headers";

import { SESSION_COOKIE_NAMES } from "./session-cookies";

/**
 * Staff sessions, held in httpOnly cookies.
 *
 * ⚠️ THE BROWSER NEVER SEES A JWT. Tokens live in httpOnly cookies that only the Next server can
 * read, and every call to the API is made server-side. The alternative — keeping an access token
 * in localStorage and calling the API from the browser — means any XSS anywhere on this app
 * exfiltrates a token that can create, edit and unpublish listings. It also forces CORS open.
 * The cost is that admin pages cannot be statically rendered, which for an admin app is no cost.
 */

const { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE } = SESSION_COOKIE_NAMES;

/** Mirrors JWT_REFRESH_TTL_DAYS on the API. */
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * ⚠️ Shorter than the access token's own 15-minute lifetime, on purpose.
 *
 * The cookie expiring slightly early means the server treats the token as gone and refreshes,
 * rather than sending a JWT that the API is about to reject. It turns a guaranteed 401-and-retry
 * into an ordinary refresh, which is one fewer round trip and one fewer chance to hit the race
 * described in `apiFetch`.
 */
const ACCESS_MAX_AGE_SECONDS = 13 * 60;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // Off in dev because the admin runs on plain http://localhost.
    secure: process.env.NODE_ENV === "production",
    /*
     * `lax`, not `strict`. Strict would drop the cookie on any cross-site navigation into the
     * admin — including a link from an email or the public site — presenting a logged-in user
     * with a login page for no reason. Lax still withholds it from cross-site POSTs, which is the
     * CSRF case that matters.
     */
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export async function readSession(): Promise<{
  accessToken?: string;
  refreshToken?: string;
}> {
  const store = await cookies();
  return {
    accessToken: store.get(ACCESS_COOKIE)?.value,
    refreshToken: store.get(REFRESH_COOKIE)?.value,
  };
}

/**
 * ⚠️ Only callable from a Route Handler or a Server Action.
 *
 * Next forbids mutating cookies during the render of a Server Component, and it throws a message
 * that does not obviously point here. Login, refresh and logout are therefore all route handlers
 * or actions — never something a page does while rendering.
 */
export async function writeSession(tokens: SessionTokens): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(ACCESS_MAX_AGE_SECONDS));
  store.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE_SECONDS));
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

