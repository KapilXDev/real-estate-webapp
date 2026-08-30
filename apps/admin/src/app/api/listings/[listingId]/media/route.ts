import { NextResponse } from "next/server";

import { apiFetch } from "@/lib/api";
import { revalidateSite } from "@/lib/revalidate-site";

/**
 * Forward a photo upload to the API with the session's access token attached.
 *
 * ⚠️ THIS EXISTS BECAUSE THE BROWSER HAS NO TOKEN. The session is an httpOnly cookie, so the
 * upload cannot go straight to the API — and we would not want it to, since that would also
 * expose the API origin to the client.
 *
 * ⚠️ The body is passed through UNPARSED. Reading the multipart into memory here just to
 * re-encode it would double the memory cost of every upload for no benefit; `apiFetch` omits its
 * JSON content-type when the body is FormData so the boundary survives.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const { listingId } = await params;
  const form = await request.formData();

  const result = await apiFetch<{ id: string; deduplicated: boolean }>(
    `/staff/listings/${listingId}/media`,
    { method: "POST", body: form },
  );

  if (!result.ok) {
    // Relayed verbatim: these messages are written for the agent ("that image is 31MB, the limit
    // is 25MB", "upload a JPEG, PNG, WebP or HEIC") and are the whole point of the validation.
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  // A new photo changes every card that listing appears on.
  await revalidateSite();
  return NextResponse.json(result.data, { status: 201 });
}
