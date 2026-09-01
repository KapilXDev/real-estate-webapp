import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../../config/configuration";
import type { TenantContext } from "../../database/database.service";
import { OutboundMessageService } from "../../messaging/services/outbound-message.service";
import { LeadRepository } from "../repositories/lead.repository";

export interface SpeedToLeadInput {
  leadId: string;
  organizationId: string;
  /** The organisation's display name — what the buyer sees as the sender. */
  organizationName: string;
  contactName: string;
  /** E.164, or undefined when the form collected only an email. */
  phoneE164?: string;
  /** Recorded at the point of collection. Absence means NO. */
  whatsappOptIn: boolean;
  /** The property they enquired about, if any — used in the acknowledgement. */
  listingLabel?: string;
}

/** Why nothing was sent. Recorded rather than logged, so the agent can see it on the lead. */
export type SkipReason =
  | "disabled"
  | "no-phone"
  | "no-consent";

/**
 * The first ninety seconds.
 *
 * ⚠️ WHY THIS IS THE HIGHEST-VALUE FEATURE IN THE BUILD. Response speed dominates every other
 * variable in lead conversion — a buyer who hears back in the first minutes is dramatically more
 * likely to transact than the same buyer contacted an hour later, because they are enquiring on
 * several properties at once and the first reply frames the conversation. It is also the reason
 * `phone` outweighs every property attribute in `LeadScoringService`.
 *
 * ⚠️ THIS ACKNOWLEDGES; IT DOES NOT PRETEND TO BE THE AGENT. The message says the enquiry landed
 * and that a person will follow up. It must never be written to imply a human typed it: a buyer
 * who works out that the "immediate personal reply" was a robot trusts the next message less, and
 * the entire value here is that the channel feels personal. The agent's real reply is the point;
 * this only holds the door open.
 *
 * ⚠️ CONSENT IS A GATE, NOT A PREFERENCE, AND IT FAILS CLOSED. India's regulators treat unsolicited
 * commercial messaging as a real offence and WhatsApp will remove a number that generates
 * complaints — losing the agent the single channel this market runs on. So: no explicit opt-in
 * recorded at collection time, no message. Not "probably fine because they gave us their number".
 * `whatsappOptIn` defaults to false on the contact row precisely so that silence is a no.
 */
@Injectable()
export class SpeedToLeadService {
  private readonly logger = new Logger(SpeedToLeadService.name);

  constructor(
    private readonly outbound: OutboundMessageService,
    private readonly leads: LeadRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Fire the acknowledgement, and never let it affect the caller.
   *
   * ⚠️ RETURNS VOID AND SWALLOWS EVERYTHING. The lead is already committed and the buyer already
   * has their confirmation by the time this runs. There is no failure here worth converting into
   * a failed enquiry — a message that does not arrive costs a follow-up; a 500 on the form costs
   * the customer. Every outcome, including the skips, is written to the lead's activity trail, so
   * "nothing happened" is visible to the agent rather than silent.
   */
  async acknowledge(input: SpeedToLeadInput, context: TenantContext): Promise<void> {
    try {
      const skip = this.reasonToSkip(input);
      if (skip) {
        await this.record(input.leadId, context, skipBody(skip), {
          outcome: "skipped",
          reason: skip,
        });
        return;
      }

      const attempt = await this.outbound.send({
        toPhoneE164: input.phoneE164!,
        template: this.config.SPEED_TO_LEAD_TEMPLATE,
        languageCode: this.config.SPEED_TO_LEAD_TEMPLATE_LANGUAGE,
        /*
         * ⚠️ ORDER IS THE CONTRACT. A WhatsApp template's placeholders are positional `{{1}}`,
         * `{{2}}` … with no names, so reordering these silently swaps the buyer's name for the
         * property. Any change here has to be made against the approved template, not guessed.
         *   {{1}} the person's first name
         *   {{2}} who is replying
         *   {{3}} what they enquired about
         */
        variables: [
          firstName(input.contactName),
          input.organizationName,
          input.listingLabel ?? "your enquiry",
        ],
      });

      await this.record(
        input.leadId,
        context,
        attempt.ok
          ? attempt.delivered
            ? "Instant WhatsApp acknowledgement sent."
            : "Instant acknowledgement recorded but NOT sent — no live messaging provider is configured."
          : `Instant WhatsApp acknowledgement failed: ${attempt.error ?? "unknown error"}`,
        {
          outcome: attempt.ok ? (attempt.delivered ? "sent" : "simulated") : "failed",
          provider: attempt.provider,
          attempts: attempt.attempts,
          template: this.config.SPEED_TO_LEAD_TEMPLATE,
          ...(attempt.providerMessageId ? { providerMessageId: attempt.providerMessageId } : {}),
          ...(attempt.error ? { error: attempt.error } : {}),
        },
      );
    } catch (error) {
      /*
       * The catch-all that makes the promise above safe to leave unawaited. Reaching here means
       * even writing the trail failed, so there is nowhere left to record it but the log.
       */
      this.logger.error(
        `Speed-to-lead failed for lead ${input.leadId}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  private reasonToSkip(input: SpeedToLeadInput): SkipReason | null {
    if (!this.config.SPEED_TO_LEAD_ENABLED) return "disabled";
    if (!input.phoneE164) return "no-phone";
    if (!input.whatsappOptIn) return "no-consent";
    return null;
  }

  private async record(
    leadId: string,
    context: TenantContext,
    body: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.leads.recordActivity(
      {
        leadId,
        type: "WHATSAPP",
        body,
        // No actor: this was the system, not a person. A user id here would attribute an
        // automated message to whoever happened to be signed in.
        metadata,
      },
      context,
    );
  }
}

function skipBody(reason: SkipReason): string {
  switch (reason) {
    case "disabled":
      return "No instant acknowledgement — speed-to-lead is switched off.";
    case "no-phone":
      return "No instant acknowledgement — the enquiry left no phone number.";
    case "no-consent":
      /* Spelled out because it is the one an agent will want to act on: it is a prompt to call,
       * which consent was never required for. */
      return "No instant acknowledgement — no WhatsApp consent was given. Call or email instead.";
  }
}

/**
 * ⚠️ First name only, and never empty.
 *
 * "Hi Rajvir" reads like a person; "Hi Rajvir Kaur Sandhu" reads like a mail merge, which is
 * exactly the impression this message must not give. An empty template variable is also rejected
 * outright by Meta, so a blank name falls back rather than failing the send.
 */
export function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : "there";
}
