import { Injectable } from "@nestjs/common";

import { DatabaseService, type TenantContext } from "../../database/database.service";
import type { LeadRow } from "../dao/lead.row";

export interface LeadWriteInput {
  organizationId: string;
  contactId: string;
  listingId?: string;
  kind: string;
  channel: string;
  score: number;
  message?: string;
  requirement?: unknown;
  source?: unknown;
}

@Injectable()
export class LeadRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Find or create the person behind a lead.
   *
   * ⚠️ `contact` IS NOT UNDER RLS and that is correct — a buyer is a person, not a tenant's
   * property. The same human enquires with three brokerages and must be ONE contact row, or the
   * platform cannot tell that "Amit who asked about Phase 7" and "Amit who asked about Sector 82"
   * are the same person. The tenant-scoped thing is the LEAD, which is the commercial asset.
   *
   * ⚠️ Matched on phone FIRST, email second. WhatsApp is the dominant channel in this market, so
   * the phone number is the durable identifier people actually reuse; emails here are frequently
   * one-off or shared. Both columns carry partial unique indexes, so the upsert has to be ordered
   * rather than a single ON CONFLICT.
   */
  async findOrCreateContact(
    input: { fullName: string; email?: string; phone?: string; whatsappOptIn?: boolean },
    context: TenantContext,
  ): Promise<string> {
    return this.database.withTenant(context, async (tx) => {
      if (input.phone) {
        const byPhone = await tx<{ id: string }[]>`
          SELECT id FROM contact WHERE primary_phone = ${input.phone} LIMIT 1
        `;
        if (byPhone[0]) {
          // Backfill only. An existing contact's details are never overwritten from an
          // unauthenticated form — otherwise anyone who knows a phone number could rewrite that
          // person's name and email by submitting a contact form.
          await tx`
            UPDATE contact
               SET primary_email = coalesce(primary_email, ${input.email ?? null}),
                   full_name     = coalesce(full_name, ${input.fullName}),
                   whatsapp_opt_in = whatsapp_opt_in OR ${input.whatsappOptIn ?? false},
                   updated_at    = now()
             WHERE id = ${byPhone[0].id}
          `;
          return byPhone[0].id;
        }
      }

      if (input.email) {
        const byEmail = await tx<{ id: string }[]>`
          SELECT id FROM contact WHERE primary_email = ${input.email} LIMIT 1
        `;
        if (byEmail[0]) {
          await tx`
            UPDATE contact
               SET primary_phone = coalesce(primary_phone, ${input.phone ?? null}),
                   full_name     = coalesce(full_name, ${input.fullName}),
                   whatsapp_opt_in = whatsapp_opt_in OR ${input.whatsappOptIn ?? false},
                   updated_at    = now()
             WHERE id = ${byEmail[0].id}
          `;
          return byEmail[0].id;
        }
      }

      const rows = await tx<{ id: string }[]>`
        INSERT INTO contact (full_name, primary_email, primary_phone, whatsapp_opt_in)
        VALUES (
          ${input.fullName},
          ${input.email ?? null},
          ${input.phone ?? null},
          ${input.whatsappOptIn ?? false}
        )
        RETURNING id
      `;
      if (!rows[0]) throw new Error("contact insert returned no row");
      return rows[0].id;
    });
  }

  async create(input: LeadWriteInput, context: TenantContext): Promise<string> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO lead (
          organization_id, contact_id, listing_id, kind, channel, status, score,
          message, requirement, source
        ) VALUES (
          ${input.organizationId},
          ${input.contactId},
          ${input.listingId ?? null},
          ${input.kind}::lead_kind,
          ${input.channel}::lead_channel,
          'NEW',
          ${input.score},
          ${input.message ?? null},
          ${input.requirement ? JSON.stringify(input.requirement) : null}::jsonb,
          ${input.source ? JSON.stringify(input.source) : null}::jsonb
        )
        RETURNING id
      `;
      if (!rows[0]) throw new Error("lead insert returned no row");
      return rows[0].id;
    });
  }

  /**
   * The organisation that should receive a lead about a given listing.
   *
   * ⚠️ Runs as PLATFORM ADMIN, and this is the one place in the module that does.
   *
   * The submitter is anonymous, so there is no tenant context to resolve the listing under — and
   * a lead about a partner's listing belongs to that partner, not to the host. Without this the
   * lookup returns nothing and the lead is either dropped or misfiled to whoever happens to be
   * configured as default. The elevation is narrow by construction: one column, one row, and the
   * value returned is an organisation id the caller never sees.
   */
  async resolveListingOwner(listingId: string): Promise<{ organizationId: string } | null> {
    return this.database.withTenant({ isPlatformAdmin: true }, async (tx) => {
      const rows = await tx<{ organization_id: string }[]>`
        SELECT organization_id FROM listing WHERE id = ${listingId} LIMIT 1
      `;
      return rows[0] ? { organizationId: rows[0].organization_id } : null;
    });
  }

  /** The host organisation — where a lead with no listing context goes. */
  async findHostOrganization(): Promise<string | null> {
    return this.database.withTenant({ isPlatformAdmin: true }, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT id FROM organization WHERE is_host LIMIT 1
      `;
      return rows[0]?.id ?? null;
    });
  }

  /** The follow-up queue: kind first, then score. Tenant-scoped by RLS. */
  async findForOrg(context: TenantContext, limit = 100): Promise<LeadRow[]> {
    return this.database.withTenant(context, async (tx) => {
      return tx<LeadRow[]>`
        SELECT
          l.id, l.kind::text AS kind, l.channel::text AS channel, l.status::text AS status,
          l.score, l.message, l.requirement, l.source, l.listing_id, l.created_at,
          c.full_name, c.primary_email, c.primary_phone, c.whatsapp_opt_in
        FROM lead l
        LEFT JOIN contact c ON c.id = l.contact_id
        ORDER BY
          CASE l.kind
            WHEN 'TOUR_REQUEST'   THEN 0
            WHEN 'HOME_VALUATION' THEN 1
            WHEN 'CONTACT'        THEN 2
            ELSE 3
          END,
          l.score DESC,
          l.created_at DESC
        LIMIT ${limit}
      `;
    });
  }
}
