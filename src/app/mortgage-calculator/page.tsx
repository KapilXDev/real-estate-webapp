import type { Metadata } from "next";
import Link from "next/link";

import { MortgageCalculator } from "@/components/listings/MortgageCalculator";
import { neighborhoods } from "@/config/neighborhoods";
import { site } from "@/config/site";

/**
 * Standalone mortgage calculator.
 *
 * Exists as its own page mainly for SEO — "mortgage calculator {city}" is a searched term with
 * genuine buyer intent, and it's an easy way to pull people into the site who aren't yet ready
 * to search listings. The default price is seeded from the local median so the first number
 * shown is relevant to this market rather than a generic $400,000.
 */

export const metadata: Metadata = {
  title: `Mortgage Calculator | ${site.market.city} Home Payments`,
  description: `Estimate your total monthly payment on a ${site.market.city} home — principal, interest, taxes, insurance, HOA, and PMI in one number.`,
};

export default function MortgageCalculatorPage() {
  // Midpoint of the local price bands — a sensible starting figure for this market.
  const medianish = Math.round(
    neighborhoods.reduce((sum, n) => sum + (n.priceRange.min + n.priceRange.max) / 2, 0) /
      Math.max(1, neighborhoods.length),
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="max-w-3xl">
        <h1 className="font-display text-4xl font-semibold text-sand-950 sm:text-5xl">
          Mortgage calculator
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-sand-700">
          Most calculators show you principal and interest and stop there. This one includes
          property tax, insurance, HOA dues, and mortgage insurance — because that&rsquo;s the
          number that actually leaves your account each month.
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <MortgageCalculator homePrice={medianish} />

        <div className="space-y-6">
          <section className="rounded-card border border-sand-200 bg-white p-6">
            <h2 className="font-display text-xl font-semibold text-sand-950">
              What the estimate includes
            </h2>
            <dl className="mt-4 space-y-4 text-sm">
              {[
                {
                  term: "Principal & interest",
                  def: "Repaying the loan itself, plus the cost of borrowing it.",
                },
                {
                  term: "Property tax",
                  def: "Based on the current assessment. Note that taxes are often reassessed after a sale, which can move this figure.",
                },
                {
                  term: "Homeowner's insurance",
                  def: "Estimated at roughly 0.35% of home value annually. Your actual quote depends on the property and your carrier.",
                },
                {
                  term: "HOA dues",
                  def: "Where applicable. Condos and newer subdivisions usually have them; older single-family streets often don't.",
                },
                {
                  term: "Mortgage insurance (PMI)",
                  def: "Applies when the down payment is under 20%. It typically falls away once you reach 20% equity.",
                },
              ].map((item) => (
                <div key={item.term}>
                  <dt className="font-semibold text-sand-900">{item.term}</dt>
                  <dd className="mt-0.5 leading-relaxed text-sand-700">{item.def}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-card bg-brand-800 p-6 text-center">
            <h2 className="font-display text-xl font-semibold text-white">
              Know your number? Let&rsquo;s find the house.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-brand-100">
              Search by monthly payment rather than list price and you&rsquo;ll see a very
              different set of homes.
            </p>
            <Link
              href="/search"
              className="mt-4 inline-block rounded-md bg-white px-6 py-3 text-sm font-semibold text-brand-800 hover:bg-brand-50"
            >
              Browse {site.market.city} homes
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
