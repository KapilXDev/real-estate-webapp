import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { CreateLeadRequestDto, CreateLeadResponseDto } from "@tricity/contracts";

import type { TenantContext } from "../../database/database.service";
import { LeadRepository } from "../repositories/lead.repository";
import { LeadScoringService } from "./lead-scoring.service";

const KIND_TO_DB: Record<CreateLeadRequestDto["kind"], string> = {
  "tour-request": "TOUR_REQUEST",
  "home-valuation": "HOME_VALUATION",
  contact: "CONTACT",
  "saved-search": "SAVED_SEARCH",
};

/**
 * Lead intake.
 *
 * ⚠️ THIS IS THE REVENUE PATH. Everything else on the platform exists to produce a row here.
 * The design rule that follows from that: **an accepted lead must be durable before the request
 * returns 201**. No queueing to memory, no fire-and-forget, no "we'll write it after we notify".
 * A lead that is lost is indistinguishable from a customer who never came.
 *
 * It replaces `FileLeadStore`, which appended to `.data/leads.jsonl` on local disk — fine on a
 * developer's machine, and silent data loss on any serverless or containerised host, where the
 * filesystem is ephemeral. That failure mode is the worst kind: the form says "thank you", the
 * user believes they made contact, and nothing exists.
 */
@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name);

  constructor(
    private readonly leads: LeadRepository,
    private readonly scoring: LeadScoringService,
  ) {}

  async create(input: CreateLeadRequestDto): Promise<CreateLeadResponseDto> {
    /*
     * ROUTING. A lead about a listing belongs to whoever owns that listing — a partner's enquiry
     * is a partner's lead, and misfiling it to the host is taking someone else's customer.
     * Everything else goes to the host organisation, whose site this is.
     */
    let organizationId: string | null = null;
    let listingId: string | undefined;

    if (input.listingKey) {
      const owner = await this.leads.resolveListingOwner(input.listingKey);
      if (owner) {
        organizationId = owner.organizationId;
        listingId = input.listingKey;
      } else {
        /*
         * An unknown listing key is NOT a reason to reject the lead. The listing may have been
         * withdrawn between the page render and the submit, and the person is still a real buyer
         * who wants to talk. The context is dropped; the lead is kept.
         */
        this.logger.warn(
          `Lead referenced unknown listing ${input.listingKey}; keeping the lead without it.`,
        );
      }
    }

    organizationId ??= await this.leads.findHostOrganization();

    if (!organizationId) {
      /*
       * No host organisation configured means there is genuinely nowhere to put this. Failing
       * loudly with a 503 is the honest answer — a 200 would tell the user they had been heard
       * when nothing was stored, which is precisely the failure this module exists to end.
       */
      this.logger.error(
        "Lead intake failed: no organisation is flagged as host. " +
          "Run `npm run db:bootstrap` or set organization.is_host.",
      );
      throw new ServiceUnavailableException(
        "Enquiries cannot be accepted right now. Please call us instead.",
      );
    }

    const context: TenantContext = { organizationId };

    const contactId = await this.leads.findOrCreateContact(
      {
        fullName: input.name,
        email: input.email,
        phone: input.phone,
        whatsappOptIn: input.whatsappOptIn,
      },
      context,
    );

    const score = this.scoring.score(input);

    const id = await this.leads.create(
      {
        organizationId,
        contactId,
        listingId,
        kind: KIND_TO_DB[input.kind],
        channel: "WEB",
        score,
        message: input.message,
        // The seller/buyer specifics that do not have their own columns. jsonb rather than a
        // widening `lead` table: these vary by lead kind and are read by humans, not queried.
        requirement: {
          ...input.requirement,
          preferredDate: input.preferredDate,
          propertyAddress: input.propertyAddress,
          timeframe: input.timeframe,
        },
        source: input.source,
      },
      context,
    );

    /*
     * SPEED-TO-LEAD — deliberately still a TODO rather than a fake stub.
     *
     * Contacting a web lead within the first minute or two is the single highest-ROI action
     * available, and it is the reason `phone` is weighted so heavily in scoring. It needs a real
     * WhatsApp Business API or SMS provider plus explicit opt-in language, neither of which
     * exists yet, and a stub that logs "would have sent" is worse than nothing because it looks
     * done in a code review.
     *
     * ⚠️ WHEN THIS LANDS IT MUST NOT BLOCK THE RESPONSE. The lead is already committed above; a
     * provider outage must never turn into a failed submission and a lost customer.
     */
    this.logger.log(`Lead ${id} captured (kind=${input.kind}, score=${score})`);

    return { id, received: true };
  }

  /**
   * Move a lead through the pipeline, recording the change on its activity trail.
   *
   * ⚠️ The activity row is written AFTER the status update and is not rolled back with it — the
   * two are separate transactions. That is a deliberate simplification: losing a trail entry is an
   * annoyance, whereas failing the status change because the note failed to write would be worse.
   * If the trail ever becomes something to reconcile against, both belong in one `withTenant`.
   */
  async updateStatus(
    leadId: string,
    patch: { status?: string; assignedUserId?: string | null; note?: string },
    principal: { organizationId: string; userId: string },
  ): Promise<void> {
    const context: TenantContext = { organizationId: principal.organizationId };

    const updated = await this.leads.updateStatus(
      leadId,
      { status: patch.status, assignedUserId: patch.assignedUserId },
      context,
    );
    // Not found and not yours are the same answer — RLS filtered it, and distinguishing them
    // would turn this into a probe for which lead ids exist in a rival's pipeline.
    if (!updated) throw new NotFoundException("Lead not found.");

    const parts: string[] = [];
    if (patch.status) parts.push(`status → ${patch.status}`);
    if (patch.assignedUserId !== undefined) {
      parts.push(patch.assignedUserId ? "reassigned" : "unassigned");
    }
    if (patch.note) parts.push(patch.note);

    await this.leads.recordActivity(
      {
        leadId,
        actorUserId: principal.userId,
        type: patch.status ? "STATUS_CHANGE" : "NOTE",
        body: parts.join(" · ") || undefined,
      },
      context,
    );
  }

  /** The follow-up queue for a signed-in staff member's organisation. */
  async listForOrg(context: TenantContext) {
    const rows = await this.leads.findForOrg(context);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      channel: row.channel,
      status: row.status,
      score: row.score,
      message: row.message,
      listingId: row.listing_id,
      createdAt: row.created_at.toISOString(),
      contact: {
        name: row.full_name,
        email: row.primary_email,
        phone: row.primary_phone,
        whatsappOptIn: row.whatsapp_opt_in ?? false,
      },
      requirement: row.requirement,
      source: row.source,
    }));
  }
}
