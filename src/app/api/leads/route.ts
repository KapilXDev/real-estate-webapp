import { NextResponse } from "next/server";

import { getLeadStore } from "@/lib/leads/store";
import type { LeadInput, LeadType } from "@/lib/leads/types";

/**
 * Lead intake endpoint. Every form on the site posts here.
 *
 * Validation is deliberately forgiving on everything except name and email: a lead rejected over
 * a formatting quibble is a lost customer, and a slightly messy record is trivially fixable by
 * hand. Reject only what is genuinely unusable.
 */

const VALID_TYPES: LeadType[] = [
  "tour-request",
  "home-valuation",
  "contact",
  "saved-search",
];

/** Length caps — the only real abuse vector on an unauthenticated public endpoint. */
const MAX_FIELD_LENGTH = 2000;

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, MAX_FIELD_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const type = body.type as LeadType;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "Unknown lead type." }, { status: 400 });
  }

  const name = str(body.name);
  const email = str(body.email);

  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  // Intentionally loose: "something@something" only. Strict regexes reject valid addresses.
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const input: LeadInput = {
    type,
    name,
    email,
    phone: str(body.phone),
    message: str(body.message),
    listingKey: str(body.listingKey),
    listingAddress: str(body.listingAddress),
    listingPrice: typeof body.listingPrice === "number" ? body.listingPrice : undefined,
    preferredDate: str(body.preferredDate),
    propertyAddress: str(body.propertyAddress),
    timeframe: str(body.timeframe),
    source: {
      page: str(body.page),
      referrer: request.headers.get("referer") ?? undefined,
      utmSource: str(body.utmSource),
      utmMedium: str(body.utmMedium),
      utmCampaign: str(body.utmCampaign),
    },
  };

  try {
    const lead = await getLeadStore().create(input);

    /*
     * TODO — Phase 3, and the highest-ROI item left in the whole build:
     * fire a speed-to-lead auto-response here (SMS within 60-90 seconds, then email), plus an
     * instant notification to the agent. Research consistently puts the conversion lift from
     * fast first contact well above anything else on this list. Deliberately not stubbed with a
     * fake integration — it needs a real SMS provider and the agent's opt-in language.
     */

    return NextResponse.json({ ok: true, id: lead.id, score: lead.score }, { status: 201 });
  } catch (error) {
    console.error("Failed to persist lead:", error);
    // Never leak internals to a public form, but never silently drop a lead either.
    return NextResponse.json(
      { error: "Could not save your request. Please call or email instead." },
      { status: 500 },
    );
  }
}
