"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { setLeadStatus } from "@/app/leads/actions";
import type { Lead } from "@/app/leads/page";
import { relativeTime } from "@/lib/format";

const KIND_LABELS: Record<string, string> = {
  TOUR_REQUEST: "Wants a viewing",
  HOME_VALUATION: "Wants a valuation",
  CONTACT: "General enquiry",
  SAVED_SEARCH: "Saved a search",
};

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "VIEWING", "NEGOTIATING", "WON", "LOST"];

/**
 * One enquiry, with the action that actually matters made the most prominent thing on it.
 *
 * ⚠️ WHATSAPP IS THE PRIMARY BUTTON, NOT EMAIL. It is the dominant channel in this market — a
 * lead with a phone number can be answered in ninety seconds, and one with only an email often
 * cannot be answered at all. That is also why `phone` outweighs every property attribute in the
 * lead score. Putting "reply by email" first would be applying a western default to a market that
 * does not work that way.
 */
export function LeadRow({ lead }: { lead: Lead }) {
  const [status, setStatus] = useState(lead.status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: string) {
    const previous = status;
    // Optimistic — the select should respond immediately; revert if the server disagrees.
    setStatus(next);
    setError(null);
    startTransition(async () => {
      const result = await setLeadStatus(lead.id, next);
      if (!result.ok) {
        setStatus(previous);
        setError(result.error ?? "Could not update.");
      }
    });
  }

  /*
   * wa.me needs the number WITHOUT a leading + or any separators. Contacts are stored E.164
   * (+919876543210), so the + is stripped here. Passing it through produces a link that opens
   * WhatsApp to a blank chat, which looks like the number is wrong.
   */
  const whatsapp = lead.contact.phone?.replace(/[^\d]/g, "");

  return (
    <li className="rounded-card border border-sand-200 bg-white p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sand-950">
              {lead.contact.name ?? "Unnamed enquiry"}
            </span>
            <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs text-sand-700">
              {KIND_LABELS[lead.kind] ?? lead.kind}
            </span>
            {/*
              The score is a hypothesis, not a fitted model — shown as a quiet number rather than
              a confident badge, so it informs triage without implying more precision than it has.
            */}
            <span className="text-xs text-sand-500" title="Priority score (0-100)">
              {lead.score}
            </span>
          </div>

          <p className="mt-1 text-sm text-sand-600">
            {lead.contact.phone ?? "no phone"} · {lead.contact.email ?? "no email"} ·{" "}
            {relativeTime(lead.createdAt)}
          </p>

          {lead.message && <p className="mt-2 text-sm text-sand-800">{lead.message}</p>}

          {lead.listingId && (
            <Link
              href={`/listings/${lead.listingId}`}
              className="mt-2 inline-block text-sm text-brand-700 underline"
            >
              About one of your listings
            </Link>
          )}

          {error && (
            <p role="alert" className="mt-2 text-sm text-clay-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {whatsapp ? (
            <a
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-card bg-status-active px-4 py-2 text-sm font-medium text-white"
            >
              WhatsApp
            </a>
          ) : (
            lead.contact.email && (
              <a
                href={`mailto:${lead.contact.email}`}
                className="rounded-card border border-sand-300 px-4 py-2 text-sm text-sand-700"
              >
                Email
              </a>
            )
          )}

          <label className="sr-only" htmlFor={`status-${lead.id}`}>
            Status
          </label>
          <select
            id={`status-${lead.id}`}
            value={status}
            disabled={pending}
            onChange={(e) => change(e.target.value)}
            className="rounded-card border border-sand-300 bg-white px-2 py-2 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      </div>
    </li>
  );
}
