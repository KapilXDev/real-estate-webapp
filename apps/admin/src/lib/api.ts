import { redirect } from "next/navigation";

import { readSession } from "./session";

/**
 * The server-side API client. Everything the admin does goes through here.
 *
 * ⚠️ THIS FILE DOES NOT REFRESH TOKENS. `proxy.ts` does, before the render starts. Read the long
 * note there before adding refresh logic here — it was originally in this file and it was
 * actively harmful:
 *
 * Refresh tokens rotate, and a Server Component render CANNOT WRITE COOKIES. So refreshing here
 * consumed the old token and threw the replacement away, and the next request presented a token
 * the API had already seen — which it correctly treats as theft and revokes the whole family.
 * The user gets signed out everywhere about fifteen minutes after they stop clicking. It
 * reproduced immediately in the refresh-race test and would have been miserable to diagnose in
 * production, because the failing request is not the one that caused it.
 *
 * By the time any of this runs, the proxy has already ensured a fresh access token. A 401 here
 * therefore means the session is genuinely over, not that it expired mid-flight.
 */

function apiBaseUrl(): string {
  const base = process.env.API_URL;
  if (!base) {
    throw new Error(
      "API_URL is not set. The admin app talks to the API server-side only — see .env.example.",
    );
  }
  return base.replace(/\/$/, "");
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  /** Message extracted from the API's error body, safe to show a staff user. */
  error?: string;
}

/** Nest's error bodies put `message` as either a string or an array of validation failures. */
async function extractError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(", ");
    if (typeof body.message === "string") return body.message;
  } catch {
    // Non-JSON body — fall through.
  }
  return `Request failed (${response.status})`;
}

/**
 * Call the API as the signed-in staff member.
 *
 * ⚠️ On 401 this REDIRECTS rather than throwing. `redirect()` works by throwing a special error
 * Next unwinds, so it must not be wrapped in a try/catch here — and it gives the user the login
 * page instead of a 500, which is what an expired session should look like.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const { accessToken } = await readSession();

  // The proxy gates every page, so a missing token here means this ran outside that matcher.
  if (!accessToken) redirect("/login");

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init.headers,
      authorization: `Bearer ${accessToken}`,
    },
    // Admin data is per-user and mutable; a cached response would show one agent another's view,
    // or a stale listing immediately after an edit.
    cache: "no-store",
  });

  if (response.status === 401) redirect("/login");

  if (!response.ok) {
    return { ok: false, status: response.status, error: await extractError(response) };
  }

  // 204 has no body; parsing it throws.
  if (response.status === 204) return { ok: true, status: 204 };

  return { ok: true, status: response.status, data: (await response.json()) as T };
}

/**
 * Raw response, for anything that is not JSON.
 *
 * Photo bytes are the only current caller. `apiFetch` calls `.json()` on the body, which would
 * throw on a WebP — and buffering the image into a JS string only to re-emit it would be wasteful
 * even if it worked. This returns the untouched `Response` so the body can be streamed straight
 * through.
 */
export async function apiFetchRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const { accessToken } = await readSession();
  if (!accessToken) redirect("/login");

  return fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
}

/** Convenience for reads that should render an empty state rather than crash the page. */
export async function apiGet<T>(path: string): Promise<T | null> {
  const result = await apiFetch<T>(path);
  return result.ok ? (result.data ?? null) : null;
}
