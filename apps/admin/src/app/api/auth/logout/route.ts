import { NextResponse } from "next/server";

import { clearSession, readSession } from "@/lib/session";

/**
 * Sign out.
 *
 * ⚠️ Revokes server-side FIRST, then clears the cookies — and clears them even if revocation
 * fails. Dropping the cookie alone would leave a valid refresh token alive for 30 days on a
 * machine the user believes they have signed out of, which is the whole point of clicking logout
 * on a shared computer.
 */
export async function POST() {
  const base = process.env.API_URL;
  const { refreshToken } = await readSession();

  if (base && refreshToken) {
    try {
      await fetch(`${base.replace(/\/$/, "")}/auth/staff/logout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      });
    } catch {
      // The API being unreachable must not trap the user in a session they asked to end.
    }
  }

  await clearSession();
  return NextResponse.json({ ok: true });
}
