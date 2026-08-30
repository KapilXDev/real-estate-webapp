"use client";

import { useState } from "react";

import { formatPrice } from "@/lib/format";
import { submitLead } from "@/lib/leads/submit";
import type { Listing } from "@/lib/listings/types";

/**
 * Showing-request form — the primary conversion point on a listing page.
 *
 * Design choices, all conversion-driven:
 *  - Four fields maximum. Every additional field measurably costs completions, and anything else
 *    can be asked on the follow-up call.
 *  - Phone is optional but requested, because a text-back within minutes is the single
 *    highest-ROI follow-up available (research cites up to 391% lift from fast response).
 *  - The message is prefilled with the address so a hesitant buyer can submit with one click.
 *  - Listing context is submitted alongside the contact details, so the CRM knows exactly which
 *    property triggered the enquiry rather than just "someone enquired".
 */
export function TourRequestForm({ listing }: { listing: Listing }) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);

    const formData = new FormData(event.currentTarget);

    const problem = await submitLead({
      type: "tour-request",
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      message: formData.get("message"),
      preferredDate: formData.get("preferredDate"),
      listingKey: listing.listingKey,
      listingAddress: listing.address.unparsed,
      listingPrice: listing.listPrice,
    });

    if (problem) {
      setStatus("error");
      setError(problem);
      return;
    }
    setStatus("success");
  }

  if (status === "success") {
    return (
      <div className="rounded-card border border-brand-200 bg-brand-50 p-6">
        <h2 className="font-display text-xl font-semibold text-brand-900">
          Request received
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-brand-800">
          Thanks — you&rsquo;ll hear back shortly about touring{" "}
          {listing.address.unparsed}. If it&rsquo;s urgent, calling is always fastest.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-card border border-sand-200 bg-white p-6">
      <h2 className="font-display text-xl font-semibold text-sand-950">
        Schedule a tour
      </h2>
      <p className="mt-1 text-sm text-sand-600">
        {formatPrice(listing.listPrice)} · {listing.address.unparsed}
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <Input name="name" label="Name" required autoComplete="name" />
        <Input name="email" label="Email" type="email" required autoComplete="email" />
        <Input
          name="phone"
          label="Phone"
          type="tel"
          autoComplete="tel"
          hint="Optional — but it's the fastest way to hear back"
        />
        <Input
          name="preferredDate"
          label="Preferred date"
          type="date"
          hint="Optional"
        />

        <div>
          <label htmlFor="message" className="block text-sm font-medium text-sand-800">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            rows={3}
            defaultValue={`I'd like to schedule a tour of ${listing.address.unparsed}.`}
            className="mt-1.5 w-full rounded-md border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-brand-600 focus:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-clay-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="w-full rounded-md bg-brand-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
        >
          {status === "submitting" ? "Sending…" : "Request a tour"}
        </button>

        <p className="text-xs leading-relaxed text-sand-500">
          By submitting, you agree to be contacted about this property. No spam, and you can opt
          out any time.
        </p>
      </form>
    </section>
  );
}

function Input({
  name,
  label,
  type = "text",
  required = false,
  autoComplete,
  hint,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-sand-800">
        {label}
        {!required && hint && (
          <span className="ml-1.5 text-xs font-normal text-sand-500">{hint}</span>
        )}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        className="mt-1.5 w-full rounded-md border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-brand-600 focus:outline-none"
      />
    </div>
  );
}
