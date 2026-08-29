import type { Metadata } from "next";

import { HomeValuationForm } from "@/components/leads/HomeValuationForm";
import { neighborhoods } from "@/config/neighborhoods";
import { site } from "@/config/site";

/**
 * Seller valuation landing page.
 *
 * Converts at 5-15% against ~1% for a standard contact page, which makes it the single
 * highest-return page on the site despite sellers being only ~30% of the stated priority.
 *
 * The page has ONE job. There is deliberately no site-wide distraction here beyond the header:
 * no listing grid, no cross-links to search, no blog teasers. Every element either builds the
 * case for a human valuation or moves the visitor into the form.
 */

export const metadata: Metadata = {
  title: `What's My Home Worth? | ${site.market.city} Home Valuation`,
  description: `Find out what your ${site.market.city} home is actually worth — a real valuation from a local agent, not an automated estimate. Free and no obligation.`,
};

const REASONS = [
  {
    title: "Automated estimates don't see your house",
    body:
      "Online estimates work from public records and square footage. They don't know you redid " +
      "the kitchen, that the roof is three years old, or that the house behind you backs onto a " +
      "busy road. Those are exactly the things that move the number.",
  },
  {
    title: "Comparable sales need judgment",
    body:
      "Two homes on the same street can be worth very different amounts. Picking the right " +
      "comparables — and adjusting for condition, layout, and timing — is the actual work, and " +
      "it is not something an algorithm does well.",
  },
  {
    title: "Pricing strategy is not the same as value",
    body:
      "What a home is worth and what you should list it at are different questions. The right " +
      "asking price depends on current inventory, how fast your area is moving, and how quickly " +
      "you need to sell.",
  },
];

export default function HomeValuePage() {
  return (
    <div>
      <section className="bg-brand-900">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
            <div>
              <h1 className="font-display text-4xl font-semibold leading-tight text-white sm:text-5xl">
                What&rsquo;s your home actually worth?
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-brand-100">
                Not an automated guess — a real valuation based on what comparable homes in your
                neighborhood have actually sold for, adjusted for the condition and features of
                your specific house.
              </p>

              <ul className="mt-8 space-y-3">
                {[
                  "Recent comparable sales on your street",
                  "An honest read on current market conditions",
                  "A suggested pricing strategy, if you want one",
                  "No obligation and no pressure to list",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-brand-50">
                    <span aria-hidden="true" className="mt-0.5 text-brand-300">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:pl-8">
              <HomeValuationForm />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="font-display text-3xl font-semibold text-sand-950">
          Why not just use an online estimate?
        </h2>
        <p className="mt-4 leading-relaxed text-sand-700">
          Online estimates are a reasonable starting point and genuinely useful for a rough idea.
          They are not a valuation, and the gap between the two is often tens of thousands of
          dollars — in either direction.
        </p>

        <div className="mt-10 space-y-8">
          {REASONS.map((reason) => (
            <div key={reason.title} className="border-l-2 border-brand-200 pl-6">
              <h3 className="font-display text-xl font-semibold text-sand-950">
                {reason.title}
              </h3>
              <p className="mt-2 leading-relaxed text-sand-700">{reason.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-sand-200 bg-sand-100">
        <div className="mx-auto max-w-4xl px-4 py-14 text-center sm:px-6 lg:px-8">
          <h2 className="font-display text-2xl font-semibold text-sand-950">
            Serving {site.market.city} and surrounding neighborhoods
          </h2>
          <p className="mt-3 leading-relaxed text-sand-700">
            Including{" "}
            {neighborhoods.map((n) => n.name).join(", ")} — and everywhere in between.
          </p>
        </div>
      </section>
    </div>
  );
}
