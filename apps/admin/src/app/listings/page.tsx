import Link from "next/link";

import { Shell, StatusPill } from "@/components/Shell";
import { apiGet } from "@/lib/api";
import { money, relativeTime } from "@/lib/format";

export const metadata = { title: "Listings" };

/**
 * ⚠️ Dynamic, never cached. Inventory changes as the agent edits it, and a cached list showing a
 * listing as DRAFT thirty seconds after publishing it reads as the save having failed.
 */
export const dynamic = "force-dynamic";

interface StaffListingSummary {
  id: string;
  referenceCode: string;
  status: string;
  visibility: string;
  possession: string;
  price: number;
  title: string | null;
  citySlug: string;
  localitySlug: string;
  photoCount: number;
  updatedAt: string;
}

const FILTERS = [
  { value: "", label: "All" },
  { value: "ACTIVE", label: "Live" },
  { value: "PENDING_REVIEW", label: "Draft" },
  { value: "UNDER_OFFER", label: "Under offer" },
  { value: "SOLD", label: "Sold" },
] as const;

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const listings = (await apiGet<StaffListingSummary[]>(`/staff/listings${query}`)) ?? [];

  return (
    <Shell
      title="Listings"
      action={
        <Link
          href="/listings/new"
          className="rounded-card bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
        >
          Add listing
        </Link>
      }
    >
      <nav className="mb-4 flex gap-1" aria-label="Filter by status">
        {FILTERS.map((filter) => {
          const active = (status ?? "") === filter.value;
          return (
            <Link
              key={filter.label}
              href={filter.value ? `/listings?status=${filter.value}` : "/listings"}
              aria-current={active ? "page" : undefined}
              className={`rounded-card px-3 py-1.5 text-sm ${
                active ? "bg-brand-700 text-white" : "text-sand-700 hover:bg-sand-100"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {listings.length === 0 ? (
        <p className="rounded-card border border-sand-200 bg-white px-4 py-8 text-center text-sand-600">
          No listings yet.{" "}
          <Link href="/listings/new" className="text-brand-700 underline">
            Add your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-sand-200 rounded-card border border-sand-200 bg-white">
          {listings.map((listing) => (
            <li key={listing.id}>
              <Link
                href={`/listings/${listing.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-sand-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sand-950">
                    {listing.title ?? "Untitled listing"}
                  </p>
                  <p className="text-sm text-sand-600">
                    {listing.referenceCode} · {listing.localitySlug.replace(/-/g, " ")},{" "}
                    {listing.citySlug} · updated {relativeTime(listing.updatedAt)}
                  </p>
                </div>

                {/*
                  ⚠️ The "no photos" nudge. A listing with no pictures converts so badly that it is
                  worth an explicit warning rather than a silent zero — this is the single most
                  common reason an agent's inventory underperforms.
                */}
                {listing.photoCount === 0 ? (
                  <span className="rounded-full bg-clay-100 px-2 py-0.5 text-xs font-medium text-clay-700">
                    No photos
                  </span>
                ) : (
                  <span className="text-xs text-sand-500">{listing.photoCount} photos</span>
                )}

                {listing.visibility !== "PUBLIC" && (
                  <span className="rounded-full bg-sand-200 px-2 py-0.5 text-xs text-sand-700">
                    {listing.visibility.replace(/_/g, " ").toLowerCase()}
                  </span>
                )}

                <StatusPill status={listing.status} />

                <span className="w-24 text-right font-medium text-sand-950">
                  {money(listing.price)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
