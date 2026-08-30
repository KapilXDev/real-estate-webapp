import { Shell } from "@/components/Shell";
import { ReraForm } from "@/components/ReraForm";
import { apiGet } from "@/lib/api";

export const metadata = { title: "RERA registrations" };
export const dynamic = "force-dynamic";

export interface ReraRegistration {
  state: string;
  registrationNo: string;
  authorityName: string;
  validUntil: string | null;
}

/**
 * ⚠️ THE TRICITY IS THREE SEPARATE REGULATORS INSIDE 20 KM, and this screen exists because that
 * is the single most surprising compliance fact in this market.
 *
 * Punjab RERA covers Mohali, Kharar, Zirakpur and New Chandigarh. Chandigarh is a Union Territory
 * with its OWN authority. Panchkula is Haryana's. Holding one registration and advertising across
 * all three is not "mostly compliant" — a listing advertised without a valid registration for the
 * authority that governs it carries a penalty of up to ₹10 lakh.
 *
 * The API enforces this at publication time; this page is where the agent fixes it.
 */
const JURISDICTIONS = [
  {
    state: "Punjab",
    authority: "Punjab Real Estate Regulatory Authority",
    covers: "Mohali, Kharar, Zirakpur, New Chandigarh",
  },
  {
    state: "Chandigarh",
    authority: "Real Estate Regulatory Authority, UT Chandigarh",
    covers: "Chandigarh — a separate authority from Punjab's",
  },
  {
    state: "Haryana",
    authority: "Haryana Real Estate Regulatory Authority, Panchkula",
    covers: "Panchkula",
  },
];

export default async function ReraPage() {
  const existing = (await apiGet<ReraRegistration[]>("/staff/rera")) ?? [];
  const byState = new Map(existing.map((r) => [r.state, r]));

  return (
    <Shell title="RERA registrations">
      <p className="mb-6 max-w-2xl text-sm text-sand-600">
        Your registration number must appear on every listing you advertise. The tricity spans
        three separate authorities, and a registration with one does not cover the others — so a
        listing can only be published in a jurisdiction you are registered in.
      </p>

      <div className="space-y-4">
        {JURISDICTIONS.map((jurisdiction) => (
          <ReraForm
            key={jurisdiction.state}
            jurisdiction={jurisdiction}
            existing={byState.get(jurisdiction.state) ?? null}
          />
        ))}
      </div>
    </Shell>
  );
}
