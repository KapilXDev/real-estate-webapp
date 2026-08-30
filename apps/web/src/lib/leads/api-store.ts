import type { CreateLeadRequestDto, CreateLeadResponseDto } from "@tricity/contracts";

import type { LeadStore } from "./store";
import type { Lead, LeadInput } from "./types";

/**
 * Leads, persisted in Postgres via the NestJS API.
 *
 * ⚠️ THIS REPLACES `FileLeadStore` FOR ANY REAL DEPLOYMENT, AND THE REASON IS NOT TIDINESS.
 *
 * `FileLeadStore` appends to `.data/leads.jsonl` on the local filesystem. On Vercel, and on any
 * container that can be rescheduled, that filesystem is ephemeral and per-instance: the write
 * succeeds, the form says "thank you", the user believes they have made contact — and the record
 * is gone at the next deploy, or lives on one instance out of three and is invisible from the
 * others. Silent loss of the one event the entire site exists to produce.
 *
 * So the file store is now DEVELOPMENT ONLY, and `getLeadStore()` refuses it in production.
 */
export class ApiLeadStore implements LeadStore {
  readonly name = "ApiLeadStore (Postgres via API)";

  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    const base = baseUrl ?? process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
    if (!base) {
      throw new Error("ApiLeadStore requires API_URL (e.g. http://localhost:3001/api).");
    }
    this.baseUrl = base.replace(/\/$/, "");
  }

  async create(input: LeadInput): Promise<Lead> {
    const payload: CreateLeadRequestDto = {
      kind: input.type,
      name: input.name,
      email: input.email,
      phone: input.phone,
      message: input.message,
      listingKey: input.listingKey,
      preferredDate: input.preferredDate,
      propertyAddress: input.propertyAddress,
      timeframe: input.timeframe,
      source: input.source,
    };

    const response = await fetch(`${this.baseUrl}/leads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      // ⚠️ Never cached. This is a write, and Next's fetch cache defaults are aggressive enough
      // that an un-opted-out POST is a genuine hazard here.
      cache: "no-store",
    });

    if (!response.ok) {
      /*
       * Throw rather than swallow. The route handler above turns this into a 500 with a "call us
       * instead" message — which is honest. Returning a fabricated success would be the exact
       * failure mode this class exists to eliminate, just moved one layer up.
       */
      const detail = await response.text().catch(() => "");
      throw new Error(`Lead API returned ${response.status}: ${detail.slice(0, 300)}`);
    }

    const created = (await response.json()) as CreateLeadResponseDto;

    /*
     * The API deliberately does not echo the score or the assigned agent — that is internal sales
     * intelligence and does not belong in a response to an anonymous form. The `Lead` type the UI
     * expects has those fields, so they are filled locally: the score returned here is NOT the
     * authoritative one (the server computed and stored its own), it exists only so the type is
     * satisfied. Nothing in the UI displays it.
     */
    return {
      ...input,
      id: created.id,
      createdAt: new Date().toISOString(),
      score: 0,
      status: "new",
    };
  }

  async list(): Promise<Lead[]> {
    /*
     * Not implemented on purpose. Reading the lead queue requires a staff session
     * (`GET /api/staff/leads`), and this store is constructed on the public request path with no
     * credentials. A version that silently returned [] would make an empty admin screen look like
     * "no leads yet" rather than "you are not signed in".
     */
    throw new Error(
      "ApiLeadStore.list() is not available: reading leads requires an authenticated staff " +
        "session. Use GET /api/staff/leads with a staff access token.",
    );
  }
}
