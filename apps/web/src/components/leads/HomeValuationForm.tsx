"use client";

import { useState } from "react";

import { submitLead } from "@/lib/leads/submit";

/**
 * Home valuation request — the highest-converting form on the site (5-15%, vs ~1% for a standard
 * contact page).
 *
 * TWO DELIBERATE DESIGN DECISIONS:
 *
 * 1. Two steps, address first. Asking for the address before contact details is the whole trick:
 *    entering an address feels like using a tool, not filling in a lead form. By the time the
 *    contact step appears the visitor has already invested effort and is far likelier to finish.
 *
 * 2. No instant automated number. We could show an algorithmic estimate, but a wrong one destroys
 *    credibility with exactly the homeowners worth winning, and competing with Zillow's AVM is a
 *    fight not worth picking. Promising a real human valuation is both more honest and better for
 *    the agent — it forces the conversation that actually wins the listing.
 */

const TIMEFRAMES = [
  "Just curious",
  "3-6 months",
  "1-3 months",
  "Immediately",
];

export function HomeValuationForm() {
  const [step, setStep] = useState<1 | 2>(1);
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  /* Holds the SERVER's wording, so a fixable mistake ("Enter a valid Indian mobile number") is
   * shown instead of a generic apology. See lib/leads/submit.ts. */
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    const formData = new FormData(event.currentTarget);

    const problem = await submitLead({
      type: "home-valuation",
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      propertyAddress: address,
      timeframe: formData.get("timeframe"),
      message: formData.get("message"),
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
      <div className="rounded-card border border-brand-200 bg-brand-50 p-8 text-center">
        <h2 className="font-display text-2xl font-semibold text-brand-900">
          Request received
        </h2>
        <p className="mx-auto mt-3 max-w-md leading-relaxed text-brand-800">
          I&rsquo;ll pull the comparable sales for {address} and put together a real valuation —
          not an automated guess. Expect to hear from me shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-sand-200 bg-white p-6 sm:p-8">
      {/* Progress is shown explicitly so step 2 doesn't feel like a bait-and-switch. */}
      <ol className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide">
        <li className={step === 1 ? "text-brand-700" : "text-sand-400"}>1. Your address</li>
        <li aria-hidden="true" className="h-px flex-1 bg-sand-200" />
        <li className={step === 2 ? "text-brand-700" : "text-sand-400"}>2. Where to send it</li>
      </ol>

      {step === 1 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (address.trim().length > 4) setStep(2);
          }}
          className="mt-6"
        >
          <label htmlFor="property-address" className="block text-sm font-medium text-sand-800">
            What&rsquo;s the property address?
          </label>
          <input
            id="property-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            autoComplete="street-address"
            placeholder="123 Oak St, Springfield"
            className="mt-2 w-full rounded-md border border-sand-300 px-4 py-3 text-base text-sand-900 focus:border-brand-600 focus:outline-none"
          />
          <button
            type="submit"
            className="mt-4 w-full rounded-md bg-brand-700 px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-800"
          >
            Continue
          </button>
          <p className="mt-3 text-center text-xs text-sand-500">
            Free, no obligation, and I won&rsquo;t hound you.
          </p>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="rounded-md bg-sand-100 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-sand-500">Valuing</p>
            <p className="mt-0.5 font-medium text-sand-900">{address}</p>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="mt-1 text-xs font-medium text-brand-700 hover:underline"
            >
              Change address
            </button>
          </div>

          <Input name="name" label="Name" required autoComplete="name" />
          <Input name="email" label="Email" type="email" required autoComplete="email" />
          <Input name="phone" label="Phone" type="tel" autoComplete="tel" hint="Optional" />

          <div>
            <label htmlFor="timeframe" className="block text-sm font-medium text-sand-800">
              When are you thinking of selling?
            </label>
            <select
              id="timeframe"
              name="timeframe"
              defaultValue="Just curious"
              className="mt-1.5 w-full rounded-md border border-sand-300 px-3 py-2.5 text-sm text-sand-900"
            >
              {TIMEFRAMES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="valuation-message" className="block text-sm font-medium text-sand-800">
              Anything I should know about the home?
              <span className="ml-1.5 text-xs font-normal text-sand-500">Optional</span>
            </label>
            <textarea
              id="valuation-message"
              name="message"
              rows={3}
              placeholder="Recent renovations, condition, anything unusual…"
              className="mt-1.5 w-full rounded-md border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-brand-600 focus:outline-none"
            />
          </div>

          {status === "error" && (
            <p role="alert" className="text-sm text-clay-700">
              {error ?? "Something went wrong. Please try again, or call instead."}
            </p>
          )}

          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full rounded-md bg-brand-700 px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
          >
            {status === "submitting" ? "Sending…" : "Get my valuation"}
          </button>
        </form>
      )}
    </div>
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
        {hint && <span className="ml-1.5 text-xs font-normal text-sand-500">{hint}</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        className="mt-1.5 w-full rounded-md border border-sand-300 px-3 py-2.5 text-sm text-sand-900 focus:border-brand-600 focus:outline-none"
      />
    </div>
  );
}
