import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAMES } from "@/lib/session-cookies";

/**
 * Session gate AND the single place a token refresh happens.
 *
 * ⚠️⚠️ REFRESH LIVES HERE, NOT IN `apiFetch`, AND THAT IS THE WHOLE POINT OF THIS FILE.
 *
 * The obvious design — refresh lazily inside the API client when a call 401s — is broken in a way
 * that only shows up in production. Refresh tokens ROTATE, and refreshing during a Server
 * Component render CANNOT PERSIST THE NEW ONE: Next forbids writing cookies while rendering. So
 * the old token gets consumed, the replacement is thrown away, and the *next* request presents a
 * token the API has already seen — which it correctly treats as theft and revokes the entire
 * family. The user is signed out everywhere, roughly fifteen minutes after they last did anything.
 *
 * That was not hypothetical. It reproduced on the first run of the refresh-race test: eight
 * parallel requests all succeeded, and then the very next request 500'd with a dead session.
 *
 * Proxy runs BEFORE rendering and can write to both sides:
 *   - `request.cookies.set(...)` so this render sees the fresh access token
 *   - `response.cookies.set(...)` so the browser keeps it
 *
 * It also means ONE refresh per request rather than one per API call, which removes the
 * intra-render race entirely — a page making five API calls now refreshes once, not five times.
 *
 * ⚠️ This is still a REDIRECT GATE, NOT AN AUTHORISATION CHECK. It never verifies a signature.
 * The real check is the API's `JwtAuthGuard` on every call; a forged cookie gets past this and
 * then fails there. The purpose here is to send a signed-out user to /login rather than render a
 * page that throws.
 */

const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** Deliberately shorter than the JWT's own 15 minutes — refresh early rather than on a 401. */
const ACCESS_MAX_AGE_SECONDS = 13 * 60;

/**
 * ⚠️ Single-flight, keyed on the refresh token.
 *
 * Two browser tabs waking at once still produce two concurrent proxy invocations with the same
 * token. Within one process this collapses them into one exchange.
 *
 * Keyed on the token rather than held in a single module-level variable: a single variable would
 * serialise refreshes across DIFFERENT users sharing the process, and one could receive the
 * other's tokens.
 *
 * The Next docs warn that proxy may be deployed somewhere invocations do not share memory, in
 * which case this degrades to no protection — but the dominant case (one page load, several API
 * calls) is already handled by refreshing here at all, and this covers the rest in practice.
 */
const inFlight = new Map<string, Promise<Tokens | null>>();

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

async function exchange(refreshToken: string): Promise<Tokens | null> {
  const existing = inFlight.get(refreshToken);
  if (existing) return existing;

  const attempt = (async (): Promise<Tokens | null> => {
    try {
      const base = process.env.API_URL;
      if (!base) return null;

      const response = await fetch(`${base.replace(/\/$/, "")}/auth/staff/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
      if (!response.ok) return null;
      return (await response.json()) as Tokens;
    } catch {
      return null;
    } finally {
      // Cleared even on failure: leaving a rejected entry would make every later request await a
      // promise that can never succeed.
      inFlight.delete(refreshToken);
    }
  })();

  inFlight.set(refreshToken, attempt);
  return attempt;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // `lax`, not `strict` — strict drops the cookie on any inbound link and shows a signed-in
    // user a login page for no reason. It still withholds it from cross-site POSTs.
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function toLogin(request: NextRequest): NextResponse {
  const login = new URL("/login", request.url);
  const from = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (from && from !== "/") login.searchParams.set("from", from);

  const response = NextResponse.redirect(login);
  // Clear a dead session on the way out, or the gate lets them through again on the next request
  // and they bounce between a broken page and here.
  response.cookies.delete(SESSION_COOKIE_NAMES.access);
  response.cookies.delete(SESSION_COOKIE_NAMES.refresh);
  return response;
}

export async function proxy(request: NextRequest) {
  const access = request.cookies.get(SESSION_COOKIE_NAMES.access)?.value;
  const refresh = request.cookies.get(SESSION_COOKIE_NAMES.refresh)?.value;

  if (access) return NextResponse.next();
  if (!refresh) return toLogin(request);

  const tokens = await exchange(refresh);
  if (!tokens) return toLogin(request);

  /*
   * Rewrite the INCOMING request's cookies so this render reads the new access token, then set
   * them on the response so the browser keeps them. Doing only the second would make the current
   * page render with no access token and 401 its way to a login redirect — the refresh would
   * "work" and the page would still fail.
   */
  request.cookies.set(SESSION_COOKIE_NAMES.access, tokens.accessToken);
  request.cookies.set(SESSION_COOKIE_NAMES.refresh, tokens.refreshToken);

  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(
    SESSION_COOKIE_NAMES.access,
    tokens.accessToken,
    cookieOptions(ACCESS_MAX_AGE_SECONDS),
  );
  response.cookies.set(
    SESSION_COOKIE_NAMES.refresh,
    tokens.refreshToken,
    cookieOptions(REFRESH_MAX_AGE_SECONDS),
  );
  return response;
}

export const config = {
  /*
   * Everything except /login, the auth route handlers, and Next's own assets.
   *
   * ⚠️ `/api/auth` must be excluded or login itself would redirect to login — the classic proxy
   * loop, which presents as ERR_TOO_MANY_REDIRECTS on the one page that has to work.
   */
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
