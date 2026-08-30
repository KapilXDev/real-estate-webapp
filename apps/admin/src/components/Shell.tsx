import Link from "next/link";

import { LogoutButton } from "./LogoutButton";

/**
 * The frame every signed-in page renders inside.
 *
 * Deliberately plain: this is a tool used all day by one or two people, not a marketing surface.
 * Navigation is a flat list because there are five destinations and a collapsible sidebar would
 * be ceremony around nothing.
 */

const NAV = [
  { href: "/listings", label: "Listings" },
  { href: "/leads", label: "Enquiries" },
  { href: "/rera", label: "RERA" },
] as const;

export function Shell({
  children,
  title,
  action,
}: {
  children: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-sand-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/listings" className="font-semibold text-brand-800">
            Tricity Estate
          </Link>
          <nav className="flex flex-1 gap-1" aria-label="Main">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-card px-3 py-1.5 text-sm text-sand-700 hover:bg-sand-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <LogoutButton />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold text-sand-950">{title}</h1>
          {action}
        </div>
        {children}
      </main>
    </div>
  );
}

/**
 * Status pill.
 *
 * ⚠️ Renders the RAW DB status, including DRAFT / PENDING_REVIEW / WITHDRAWN — statuses the
 * public mapper refuses outright. The agent's own screens are exactly where those need to be
 * visible, which is why the staff projection passes them through untranslated.
 */
export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    ACTIVE: "bg-status-active/10 text-status-active",
    UNDER_OFFER: "bg-status-contract/10 text-status-contract",
    PENDING_REVIEW: "bg-status-coming/10 text-status-coming",
    DRAFT: "bg-sand-200 text-sand-700",
    SOLD: "bg-status-closed/10 text-status-closed",
    RENTED: "bg-status-closed/10 text-status-closed",
  };

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        tone[status] ?? "bg-sand-200 text-sand-700"
      }`}
    >
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}
