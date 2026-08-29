import { cn } from "@/lib/cn";
import type { ListingStatus } from "@/lib/listings/types";

/**
 * Listing status pill. Status drives buyer behaviour more than almost any other field —
 * "Under Offer" saves people a wasted site visit — so it is always visible, never truncated,
 * and uses consistent colors sitewide.
 *
 * The US escrow states ("Pending", "Active Under Contract") were removed in the India pivot:
 * a transaction here runs agreement-to-sell → registry, and "Under Offer" (token/bayana taken)
 * is the honest equivalent.
 */

const STATUS_STYLES: Record<ListingStatus, { label: string; className: string }> = {
  Active: {
    label: "Available",
    className: "bg-status-active text-white",
  },
  "Coming Soon": {
    label: "Coming Soon",
    className: "bg-status-coming text-white",
  },
  "Under Offer": {
    label: "Under Offer",
    className: "bg-status-contract text-white",
  },
  Sold: {
    label: "Sold",
    className: "bg-status-closed text-white",
  },
  Rented: {
    label: "Rented",
    className: "bg-status-closed text-white",
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: ListingStatus;
  className?: string;
}) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide uppercase",
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
}
