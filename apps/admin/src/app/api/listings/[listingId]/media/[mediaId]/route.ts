import { NextResponse } from "next/server";

import { apiFetch } from "@/lib/api";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ listingId: string; mediaId: string }> },
) {
  const { listingId, mediaId } = await params;

  const result = await apiFetch(`/staff/listings/${listingId}/media/${mediaId}`, {
    method: "DELETE",
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return new NextResponse(null, { status: 204 });
}
