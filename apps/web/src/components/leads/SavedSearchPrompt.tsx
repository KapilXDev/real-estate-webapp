"use client";

import { useState } from "react";

import { submitLead } from "@/lib/leads/submit";

/**
 * Saved-search / instant-alert signup.
 *
 * This is the highest-value email capture on the site. Research is consistent that saved searches
 * with new-listing alerts are the feature serious buyers most want — and crucially, people hand
 * over an email for alerts willingly, where they resist a bare "contact me" form. It also
 * converts a one-time visitor into a recurring touchpoint, which is the whole game against the
 * portals.
 *
 * Deliberately asks for email ONLY. Every additional field costs signups, and the buyer's
 * criteria are already captured from the filters they set — which is far better data than
 * anything they would type into a "what are you looking for?" box.
 */
export function SavedSearchPrompt({
  searchDescription,
  queryString,
}: {
  searchDescription: string;
  queryString: string;
}) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  /* Holds the SERVER's wording, so a fixable mistake ("Enter a valid Indian mobile number") is
   * shown instead of a generic apology. See lib/leads/submit.ts. */
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    const formData = new FormData(event.currentTarget);

    const problem = await submitLead({
      type: "saved-search",
      // No name field on this form — the follow-up email asks, once they're already engaged.
      name: "Saved search subscriber",
      email: formData.get("email"),
      message: `Saved search: ${searchDescription} (/search?${queryString})`,
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
      <div className="rounded-card border border-brand-200 bg-brand-50 p-6 text-center">
        <h2 className="font-display text-xl font-semibold text-brand-900">
          Alerts are on
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-brand-800">
          You&rsquo;ll get an email the moment a new home matching this search hits the market —
          usually before it shows up on the big portals.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-card border border-sand-200 bg-white p-6 sm:p-8">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-2xl font-semibold text-sand-950">
          Get alerts for this search
        </h2>
        <p className="mt-2 leading-relaxed text-sand-700">
          New listings matching{" "}
          <span className="font-medium text-sand-900">{searchDescription}</span>, emailed the day
          they hit the market. In a fast market that head start is often the whole difference.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mx-auto mt-6 flex max-w-md flex-col gap-3 sm:flex-row"
        >
          <label htmlFor="saved-search-email" className="sr-only">
            Email address
          </label>
          <input
            id="saved-search-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full rounded-md border border-sand-300 px-4 py-3 text-sm text-sand-900 focus:border-brand-600 focus:outline-none sm:flex-1"
          />
          <button
            type="submit"
            disabled={status === "submitting"}
            className="rounded-md bg-brand-700 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
          >
            {status === "submitting" ? "Saving…" : "Notify me"}
          </button>
        </form>

        {status === "error" && (
          <p role="alert" className="mt-3 text-sm text-clay-700">
            {error ?? "Something went wrong. Please try again."}
          </p>
        )}

        <p className="mt-3 text-xs text-sand-500">
          One email per matching listing. Unsubscribe any time.
        </p>
      </div>
    </section>
  );
}
