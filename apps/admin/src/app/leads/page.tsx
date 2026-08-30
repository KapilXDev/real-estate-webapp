import { Shell } from "@/components/Shell";
import { LeadRow } from "@/components/LeadRow";
import { apiGet } from "@/lib/api";

export const metadata = { title: "Enquiries" };
export const dynamic = "force-dynamic";

export interface Lead {
  id: string;
  kind: string;
  channel: string;
  status: string;
  score: number;
  message: string | null;
  listingId: string | null;
  createdAt: string;
  contact: {
    name: string | null;
    email: string | null;
    phone: string | null;
    whatsappOptIn: boolean;
  };
  requirement: unknown;
  source: unknown;
}

/**
 * The follow-up queue.
 *
 * ⚠️ ORDER COMES FROM THE API AND IS NOT RE-SORTED HERE. The server ranks by kind first (tour
 * requests, then valuations, then general enquiries) and by score within that. Re-sorting in the
 * UI — by date, say — would quietly undo the triage the scoring exists to provide, and the whole
 * point is that a solo agent cannot treat every lead identically.
 */
export default async function LeadsPage() {
  const leads = (await apiGet<Lead[]>("/staff/leads")) ?? [];

  return (
    <Shell title="Enquiries">
      {leads.length === 0 ? (
        <p className="rounded-card border border-sand-200 bg-white px-4 py-8 text-center text-sand-600">
          No enquiries yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {leads.map((lead) => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
        </ul>
      )}
    </Shell>
  );
}
