import { Injectable } from "@nestjs/common";

import { ANONYMOUS, DatabaseService, type TenantContext } from "../../database/database.service";

export interface ReraRegistration {
  state: string;
  registrationNo: string;
  authorityName: string;
  validUntil: string | null;
}

/**
 * RERA registrations, one per (organisation, jurisdiction).
 *
 * ⚠️ THE TRICITY IS THREE JURISDICTIONS INSIDE 20 KM and they do not share a regulator:
 *
 *   Punjab RERA   Mohali, Kharar, Zirakpur, New Chandigarh
 *   Chandigarh    a Union Territory with its own separate authority
 *   Haryana RERA  Panchkula
 *
 * A registered agent's number must appear in all advertising, a website is advertising, and the
 * penalty runs to ₹10 lakh. Showing the Punjab number on a Chandigarh listing is not a cosmetic
 * slip — it is advertising a property without a valid registration for the authority that
 * actually governs it. So the lookup is always keyed on the LISTING's state, never on an
 * organisation-level default.
 */
@Injectable()
export class ReraRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * The registration an organisation holds for one jurisdiction, or null.
   *
   * ⚠️ An expired registration returns NULL rather than the row. An expired number in an
   * advertisement is not partial compliance, it is a false claim of registration — worse than
   * having none, because it looks verified until someone checks it against the register.
   */
  async findValid(
    organizationId: string,
    state: string,
    context: TenantContext = ANONYMOUS,
  ): Promise<ReraRegistration | null> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<
        { state: string; registration_no: string; authority_name: string; valid_until: Date | null }[]
      >`
        SELECT state, registration_no, authority_name, valid_until
        FROM organization_rera
        WHERE organization_id = ${organizationId}
          AND state = ${state}
          AND (valid_until IS NULL OR valid_until >= current_date)
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        state: row.state,
        registrationNo: row.registration_no,
        authorityName: row.authority_name,
        validUntil: row.valid_until ? row.valid_until.toISOString().slice(0, 10) : null,
      };
    });
  }

  async listForOrg(context: TenantContext, organizationId: string): Promise<ReraRegistration[]> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<
        { state: string; registration_no: string; authority_name: string; valid_until: Date | null }[]
      >`
        SELECT state, registration_no, authority_name, valid_until
        FROM organization_rera
        WHERE organization_id = ${organizationId}
        ORDER BY state
      `;
      return rows.map((row) => ({
        state: row.state,
        registrationNo: row.registration_no,
        authorityName: row.authority_name,
        validUntil: row.valid_until ? row.valid_until.toISOString().slice(0, 10) : null,
      }));
    });
  }

  /** Add or replace the registration for one jurisdiction. */
  async upsert(
    context: TenantContext,
    input: ReraRegistration & { organizationId: string },
  ): Promise<void> {
    await this.database.withTenant(context, async (tx) => {
      await tx`
        INSERT INTO organization_rera
          (organization_id, state, registration_no, authority_name, valid_until)
        VALUES (
          ${input.organizationId}, ${input.state}, ${input.registrationNo},
          ${input.authorityName}, ${input.validUntil}::date
        )
        ON CONFLICT (organization_id, state) DO UPDATE
          SET registration_no = EXCLUDED.registration_no,
              authority_name  = EXCLUDED.authority_name,
              valid_until     = EXCLUDED.valid_until,
              updated_at      = now()
      `;
    });
  }
}
