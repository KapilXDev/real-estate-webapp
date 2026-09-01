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

/**
 * A rejection the person filling in the form can fix themselves.
 *
 * Separate from a generic failure so the route handler can answer 400 with something actionable
 * instead of 500 with an apology. Nest returns `message` as either a string or an array of
 * validation failures.
 */
export class LeadValidationError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join(" "));
    this.name = "LeadValidationError";
  }
}

async function extractValidationMessages(response: Response): Promise<string[]> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message) && body.message.length > 0) return body.message;
    if (typeof body.message === "string" && body.message.length > 0) return [body.message];
  } catch {
    // Non-JSON body — fall through to the generic wording.
  }
  return ["Please check the details you entered and try again."];
}

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
      whatsappOptIn: input.whatsappOptIn,
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
       * ⚠️ A 400 IS THE BUYER'S TYPO, NOT AN OUTAGE, AND THE DIFFERENCE MATTERS MORE HERE THAN
       * ANYWHERE ELSE ON THE SITE.
       *
       * Every failure used to become the same 500 and the same "Could not save your request,
       * please call or email instead". So someone who typed nine digits instead of ten was told
       * the site was broken, on the one page whose entire purpose is capturing a lead, with no
       * hint that the fix was one character in a field they could see. That is a lost enquiry
       * caused by an error message.
       *
       * Validation messages are safe to surface because they describe the caller's OWN input —
       * unlike a driver error or a stack trace, which is why only 400 is passed through and
       * everything else still degrades to the generic message.
       */
      if (response.status === 400) {
        throw new LeadValidationError(await extractValidationMessages(response));
      }

      /*
       * Throw rather than swallow. The route handler turns this into a 500 with a "call us
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
