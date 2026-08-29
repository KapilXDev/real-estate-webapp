import type { Metadata } from "next";
import Link from "next/link";

import { EmiCalculator } from "@/components/listings/EmiCalculator";
import { localitiesWithContent } from "@/config/localities";
import { site } from "@/config/site";
import { STAMP_DUTY_RATES } from "@/lib/home-loan";

/**
 * Standalone home loan / EMI calculator.
 *
 * Exists as its own page mainly for SEO — "home loan EMI calculator Chandigarh" and "stamp duty
 * in Punjab" are searched terms with genuine buyer intent, and an easy way to pull people into
 * the site who aren't ready to search listings yet. The default price is seeded from the local
 * price bands so the first number shown is relevant to this market.
 *
 * The differentiator versus every bank's EMI calculator is the upfront-cost panel: stamp duty and
 * registration are not financeable and routinely blindside first-time buyers. See lib/home-loan.ts.
 */

export const metadata: Metadata = {
  title: `Home Loan EMI Calculator | ${site.market.name} Stamp Duty & Costs`,
  description:
    `Work out your home loan EMI plus the cash you actually need upfront — stamp duty, ` +
    `registration and processing fees for Chandigarh, Punjab and Haryana.`,
};

export default function HomeLoanCalculatorPage() {
  // Midpoint of the local price bands — a sensible starting figure for this market.
  const localities = localitiesWithContent();
  const medianish = Math.round(
    localities.reduce(
      (sum, l) => sum + (l.content!.priceRange.min + l.content!.priceRange.max) / 2,
      0,
    ) / Math.max(1, localities.length),
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold text-sand-950 sm:text-5xl">
          Home loan &amp; cost calculator
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-sand-700">
          Most calculators show you an EMI and stop there. This one also shows the cash you need
          on the day — stamp duty, registration and processing fees included, because that is the
          part that catches people out.
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <EmiCalculator propertyPrice={medianish} />

        <div className="space-y-6">
          <section className="rounded-card border border-sand-200 bg-white p-6">
            <h2 className="font-display text-xl font-semibold text-sand-950">
              What the estimate includes
            </h2>
            <dl className="mt-4 space-y-4 text-sm">
              {[
                {
                  term: "EMI (principal & interest)",
                  def: "Repaying the loan itself, plus the cost of borrowing it, spread over the tenure you choose.",
                },
                {
                  term: "Stamp duty",
                  def: "Paid to the state at registry, calculated on the transaction value. Rates differ by state and are lower when registering in a woman's name.",
                },
                {
                  term: "Registration fee",
                  def: "Charged by the sub-registrar on top of stamp duty, typically around 1%.",
                },
                {
                  term: "Loan processing fee",
                  def: "Charged by the lender, usually around 0.5% of the loan and capped. Often negotiable.",
                },
                {
                  term: "Society maintenance",
                  def: "A recurring monthly charge on flats and gated developments. Ask what it covers and whether the sinking fund is healthy.",
                },
              ].map((item) => (
                <div key={item.term}>
                  <dt className="font-semibold text-sand-900">{item.term}</dt>
                  <dd className="mt-0.5 leading-relaxed text-sand-700">{item.def}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/*
           * A jurisdiction comparison table, because tricity buyers routinely shortlist across
           * all three — and an identically-priced property costs meaningfully more to register in
           * Punjab than in Chandigarh.
           */}
          <section className="rounded-card border border-sand-200 bg-white p-6">
            <h2 className="font-display text-xl font-semibold text-sand-950">
              Stamp duty across the tricity
            </h2>
            <table className="mt-4 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-sand-200 text-left">
                  <th scope="col" className="pb-2 font-semibold text-sand-900">State</th>
                  <th scope="col" className="pb-2 font-semibold text-sand-900">Standard</th>
                  <th scope="col" className="pb-2 font-semibold text-sand-900">Female buyer</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(STAMP_DUTY_RATES).map(([state, rates]) => (
                  <tr key={state} className="border-b border-sand-100">
                    <th scope="row" className="py-2 text-left font-medium text-sand-800">
                      {state}
                    </th>
                    <td className="py-2 tabular-nums text-sand-700">
                      {(rates.male * 100).toFixed(0)}%
                    </td>
                    <td className="py-2 tabular-nums text-sand-700">
                      {(rates.female * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs leading-relaxed text-sand-500">
              Indicative rates, exclusive of registration fee. These change in state budgets —
              confirm current rates with the sub-registrar before you budget.
            </p>
          </section>

          <section className="rounded-card bg-brand-800 p-6 text-center">
            <h2 className="font-display text-xl font-semibold text-white">
              Know your number? Let&rsquo;s find the property.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-brand-100">
              Search by what you can actually service each month rather than by asking price, and
              you&rsquo;ll see a very different shortlist.
            </p>
            <Link
              href="/search"
              className="mt-4 inline-block rounded-md bg-white px-6 py-3 text-sm font-semibold text-brand-800 hover:bg-brand-50"
            >
              Browse tricity property
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
