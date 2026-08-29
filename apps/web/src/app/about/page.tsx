import type { Metadata } from "next";
import Link from "next/link";

import { neighborhoods } from "@/config/neighborhoods";
import { site } from "@/config/site";

/**
 * About page.
 *
 * PLACEHOLDER CONTENT — the testimonials and stats below are structural examples showing where
 * real content goes. Replace all of it before launch; fabricated testimonials on a real estate
 * site are both a trust problem and, in most states, a licensing one.
 *
 * The `Person` + `RealEstateAgent` schema at the bottom is genuinely useful: it feeds Google's
 * entity understanding of the agent, which supports the local pack ranking that drives most
 * agent-site traffic.
 */

export const metadata: Metadata = {
  title: `About ${site.agent.name}`,
  description: `${site.agent.name}, ${site.agent.title} serving ${site.market.city}, ${site.market.stateFull}. ${site.agent.tagline}`,
};

/** PLACEHOLDER — replace with real, attributable client testimonials. */
const TESTIMONIALS = [
  {
    quote:
      "Placeholder testimonial. Replace with a real client quote — the more specific it is about " +
      "what actually happened, the more persuasive it reads.",
    author: "Client name",
    context: "Bought in [Neighborhood], 2025",
  },
  {
    quote:
      "Placeholder testimonial. Two or three strong, specific quotes outperform a long wall of " +
      "generic praise.",
    author: "Client name",
    context: "Sold in [Neighborhood], 2025",
  },
];

/** PLACEHOLDER — replace with real figures, or delete the section entirely. */
const STATS = [
  { value: "—", label: "Years in the business" },
  { value: "—", label: "Homes closed" },
  { value: "—", label: "Average days on market" },
];

export default function AboutPage() {
  return (
    <div>
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h1 className="font-display text-4xl font-semibold text-sand-950 sm:text-5xl">
              About {site.agent.name}
            </h1>
            <p className="mt-4 text-lg font-medium text-sand-600">{site.agent.tagline}</p>

            <div className="mt-8 space-y-5 leading-relaxed text-sand-700">
              <p>{site.agent.bio}</p>
              <p>
                {/* Guidance for whoever writes the real copy. */}
                Replace this section with the real story: how you got into real estate, which
                neighborhoods you know best, the kind of client you work well with, and what you
                do differently. Specific beats polished — buyers are choosing a person, not a
                brochure.
              </p>
            </div>

            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                href="/contact"
                className="rounded-md bg-brand-700 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-800"
              >
                Get in touch
              </Link>
              <Link
                href="/listings"
                className="rounded-md border border-sand-300 bg-white px-6 py-3 text-sm font-semibold text-sand-800 hover:border-sand-400"
              >
                See my listings
              </Link>
            </div>
          </div>

          <aside>
            {/* Headshot placeholder — drop a real photo at /public/agent/headshot.jpg. */}
            <div className="flex aspect-[4/5] items-center justify-center rounded-card bg-sand-200 text-sm text-sand-600">
              Agent photo
            </div>
            <div className="mt-6 rounded-card border border-sand-200 bg-white p-5 text-sm">
              <p className="font-semibold text-sand-900">{site.agent.name}</p>
              <p className="text-sand-600">{site.agent.title}</p>
              <p className="mt-3 text-sand-700">{site.brokerage.name}</p>
              <p className="mt-1 text-xs text-sand-500">{site.agent.licenseNumber}</p>
              <a
                href={`tel:${site.agent.phone.replace(/[^\d+]/g, "")}`}
                className="mt-4 block font-medium text-brand-700 hover:underline"
              >
                {site.agent.phone}
              </a>
              <a
                href={`mailto:${site.agent.email}`}
                className="block font-medium text-brand-700 hover:underline"
              >
                {site.agent.email}
              </a>
            </div>
          </aside>
        </div>
      </section>

      <section className="border-y border-sand-200 bg-sand-100">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <dl className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <dt className="text-sm uppercase tracking-wide text-sand-600">{stat.label}</dt>
                <dd className="mt-1 font-display text-4xl font-semibold text-brand-800">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="font-display text-3xl font-semibold text-sand-950">
          What clients say
        </h2>
        <div className="mt-8 grid gap-8 md:grid-cols-2">
          {TESTIMONIALS.map((testimonial) => (
            <figure
              key={testimonial.author + testimonial.context}
              className="rounded-card border border-sand-200 bg-white p-6"
            >
              <blockquote className="leading-relaxed text-sand-800">
                &ldquo;{testimonial.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-4 border-t border-sand-100 pt-4 text-sm">
                <span className="font-semibold text-sand-900">{testimonial.author}</span>
                <span className="block text-sand-600">{testimonial.context}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="border-t border-sand-200 bg-sand-100">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
          <h2 className="font-display text-2xl font-semibold text-sand-950">
            Areas I work
          </h2>
          <div className="mt-5 flex flex-wrap gap-3">
            {neighborhoods.map((n) => (
              <Link
                key={n.slug}
                href={`/neighborhoods/${n.slug}`}
                className="rounded-full border border-sand-300 bg-white px-4 py-2 text-sm font-medium text-sand-800 hover:border-brand-400 hover:text-brand-700"
              >
                {n.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <AgentJsonLd />
    </div>
  );
}

function AgentJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    name: site.agent.name,
    jobTitle: site.agent.title,
    telephone: site.agent.phone,
    email: site.agent.email,
    description: site.agent.tagline,
    worksFor: {
      "@type": "Organization",
      name: site.brokerage.name,
      address: site.brokerage.address,
    },
    areaServed: neighborhoods.map((n) => ({
      "@type": "Place",
      name: `${n.name}, ${site.market.city}, ${site.market.state}`,
    })),
    address: {
      "@type": "PostalAddress",
      addressLocality: site.market.city,
      addressRegion: site.market.state,
      addressCountry: "US",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
