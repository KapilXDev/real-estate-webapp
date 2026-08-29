import type { Metadata } from "next";

import { ContactForm } from "@/components/leads/ContactForm";
import { site } from "@/config/site";

/**
 * Contact page.
 *
 * Phone and email are shown as plain, tappable links ABOVE the form on purpose. A meaningful
 * share of people arriving here want to call, and burying the number behind a form loses them.
 * The form is for everyone else.
 */

export const metadata: Metadata = {
  title: "Contact",
  description: `Get in touch with ${site.agent.name}, ${site.agent.title} covering Chandigarh, Mohali and Kharar.`,
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="grid gap-12 lg:grid-cols-2">
        <div>
          <h1 className="font-display text-4xl font-semibold text-sand-950 sm:text-5xl">
            Get in touch
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-sand-700">
            Whether you&rsquo;re months away from moving or want to see something this weekend,
            I&rsquo;m happy to talk. No pressure and no script.
          </p>

          <div className="mt-8 space-y-4">
            <a
              href={`tel:${site.agent.phone.replace(/[^\d+]/g, "")}`}
              className="flex items-center gap-4 rounded-card border border-sand-200 bg-white p-5 transition-colors hover:border-brand-300"
            >
              <span aria-hidden="true" className="text-2xl">📞</span>
              <span>
                <span className="block text-xs uppercase tracking-wide text-sand-500">Call</span>
                <span className="block font-semibold text-sand-900">{site.agent.phone}</span>
              </span>
            </a>

            {/*
             * WhatsApp sits directly under the phone number, above email, because it is the
             * dominant channel in this market — most enquiries arrive there rather than by mail.
             */}
            <a
              href={`https://wa.me/${site.agent.whatsapp}`}
              className="flex items-center gap-4 rounded-card border border-sand-200 bg-white p-5 transition-colors hover:border-brand-300"
            >
              <span aria-hidden="true" className="text-2xl">💬</span>
              <span>
                <span className="block text-xs uppercase tracking-wide text-sand-500">
                  WhatsApp
                </span>
                <span className="block font-semibold text-sand-900">Send a message</span>
              </span>
            </a>

            <a
              href={`mailto:${site.agent.email}`}
              className="flex items-center gap-4 rounded-card border border-sand-200 bg-white p-5 transition-colors hover:border-brand-300"
            >
              <span aria-hidden="true" className="text-2xl">✉️</span>
              <span>
                <span className="block text-xs uppercase tracking-wide text-sand-500">Email</span>
                <span className="block font-semibold text-sand-900">{site.agent.email}</span>
              </span>
            </a>
          </div>

          <div className="mt-8 rounded-card bg-sand-100 p-6">
            <h2 className="font-display text-lg font-semibold text-sand-950">
              {site.firm.name}
            </h2>
            <p className="mt-1 text-sm text-sand-700">{site.firm.address}</p>
            <p className="mt-3 text-xs text-sand-600">
              {site.agent.name}, {site.agent.title}
            </p>
            <div className="mt-2 space-y-0.5 text-xs text-sand-600">
              {Object.values(site.rera.byState).map((j) => (
                <p key={j.registration}>
                  {j.shortName} Reg. No. {j.registration}
                </p>
              ))}
            </div>
          </div>
        </div>

        <div>
          <ContactForm />
        </div>
      </div>
    </div>
  );
}
