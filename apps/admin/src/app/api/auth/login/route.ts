import { NextResponse } from "next/server";

import { writeSession, type SessionTokens } from "@/lib/session";

/**
 * Exchange credentials for a session cookie.
 *
 * A route handler rather than a Server Action purely because it must set cookies and return a
 * redirect target; both are natural here and it keeps the login form working without JavaScript.
 *
 * ⚠️ The API's own rate limit (10 login attempts/minute/IP) is the credential-stuffing defence.
 * This handler adds none of its own — doubling it up would only make the two disagree about when
 * a user is locked out.
 */
export async function POST(request: Request) {
  const base = process.env.API_URL;
  if (!base) {
    return NextResponse.json({ error: "API_URL is not configured." }, { status: 500 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const response = await fetch(`${base.replace(/\/$/, "")}/auth/staff/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: "no-store",
  });

  if (!response.ok) {
    /*
     * ⚠️ One message for every failure mode, deliberately. The API already returns identical
     * responses for "unknown email" and "wrong password" — and burns equal time on both — so that
     * this endpoint cannot be used to enumerate which addresses have accounts. Relaying a more
     * specific message here would give that away at the last step.
     */
    return NextResponse.json(
      { error: response.status === 429 ? "Too many attempts. Wait a minute." : "Email or password is incorrect." },
      { status: response.status === 429 ? 429 : 401 },
    );
  }

  const tokens = (await response.json()) as SessionTokens;
  await writeSession(tokens);

  return NextResponse.json({ ok: true });
}
