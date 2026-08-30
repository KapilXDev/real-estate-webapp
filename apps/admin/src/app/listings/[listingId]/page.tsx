import { notFound } from "next/navigation";

import { Shell, StatusPill } from "@/components/Shell";
import { ListingForm, type ExistingListing } from "@/components/ListingForm";
import { PhotoManager } from "@/components/PhotoManager";
import { apiGet } from "@/lib/api";
import { updateListing } from "../actions";

export const dynamic = "force-dynamic";

interface AdminMedia {
  id: string;
  url: string;
  caption: string;
  order: number;
  status: string;
  error: string | null;
}

export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { listingId } = await params;
  const { created } = await searchParams;

  const listing = await apiGet<ExistingListing & { referenceCode: string; photoCount: number }>(
    `/staff/listings/${listingId}`,
  );
  if (!listing) notFound();

  const photos = (await apiGet<AdminMedia[]>(`/staff/listings/${listingId}/media`)) ?? [];

  return (
    <Shell
      title={listing.title ?? "Listing"}
      action={<StatusPill status={listing.status} />}
    >
      <p className="mb-6 text-sm text-sand-600">{listing.referenceCode}</p>

      {/*
        Arriving straight from creation: photos are the next thing that matters, and a listing
        published without them converts badly. Say so rather than leaving a silent empty section.
      */}
      {created && photos.length === 0 && (
        <p className="mb-6 rounded-card border border-status-active/30 bg-status-active/10 px-4 py-3 text-sm text-status-active">
          Listing created. Add photos below — listings without them get far fewer enquiries.
        </p>
      )}

      <div className="mb-10">
        <h2 className="mb-3 font-medium text-sand-900">Photos</h2>
        <PhotoManager listingId={listingId} initialPhotos={photos} />
      </div>

      <div className="rounded-card border border-sand-200 bg-white p-6">
        <ListingForm
          action={updateListing.bind(null, listingId)}
          existing={listing}
        />
      </div>
    </Shell>
  );
}
