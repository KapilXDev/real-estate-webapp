import { NextResponse } from "next/server";

import { apiFetch } from "@/lib/api";
import { revalidateSite } from "@/lib/revalidate-site";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ listingId: string }> },
) {
  const { listingId } = await params;
  const body = await request.text();

  const result = await apiFetch(`/staff/listings/${listingId}/media/order`, {
    method: "PUT",
    body,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await revalidateSite();
  return new NextResponse(null, { status: 204 });
}
