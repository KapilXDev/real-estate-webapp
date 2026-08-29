import { cn } from "@/lib/cn";
import type { ListingStatus } from "@/lib/listings/types";

/**
 * Listing status pill. Status drives buyer behaviour more than almost any other field —
 * "Pending" saves people a wasted showing request — so it is always visible, never truncated,
 * and uses consistent colors sitewide.
 */

const STATUS_STYLES: Record<ListingStatus, { label: string; className: string }> = {
  Active: {
    label: "Active",
    className: "bg-status-active text-white",
  },
  "Coming Soon": {
    label: "Coming Soon",
    className: "bg-status-coming text-white",
  },
  "Active Under Contract": {
    // Shortened: the full RESO value overflows a card badge, and buyers say "under contract".
    label: "Under Contract",
    className: "bg-status-contract text-white",
  },
  Pending: {
    label: "Pending",
    className: "bg-status-pending text-white",
  },
  Closed: {
    label: "Sold",
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
