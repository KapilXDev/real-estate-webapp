/**
 * The seam between "we decided to message someone" and "a network call happened".
 *
 * ⚠️ WHY AN INTERFACE RATHER THAN CALLING META DIRECTLY. Three unrelated things will send messages
 * before launch — speed-to-lead, saved-search alerts, the monthly market email — and the transport
 * under them is a business decision that is not made yet: Meta's WhatsApp Cloud API direct, or a
 * BSP like Gupshup or Twilio, which is often easier to get approved in India. Everything above
 * this line should not have to care, and none of it should have to be rewritten when that choice
 * changes.
 *
 * ⚠️⚠️ WHATSAPP IS NOT SMS, AND THE DIFFERENCE IS NOT COSMETIC. Read this before implementing a
 * real provider, because the constraints shape the whole API below:
 *
 *  - **Outside a 24-hour customer service window you may only send a PRE-APPROVED TEMPLATE.** A
 *    lead who has just filled in a web form has not messaged us on WhatsApp, so there is no
 *    window open and the first message is ALWAYS a template. That is why this interface takes a
 *    template name plus variables and has no "send arbitrary text" method — free text is not a
 *    thing we are permitted to send here, and an API that allowed it would invite code that
 *    cannot work in production.
 *  - **Templates are submitted to Meta and approved by a human**, typically in hours to days, and
 *    a rejected template is a business problem, not a deploy problem. Template NAMES therefore
 *    live in config, so the copy can change without a release.
 *  - **Every send costs money** and is billed per conversation. A retry loop that does not
 *    distinguish "the network failed" from "Meta rejected this" will spend real money repeating a
 *    request that can never succeed. See `OutboundSendError.retryable`.
 *  - **Consent is a legal requirement, not a preference.** The opt-in has to be recorded at the
 *    point of collection, which `contact.whatsapp_opt_in` does. Nothing in this module decides
 *    whether consent exists; it only refuses to act without it.
 */

/** Injection token — the interface is a type and cannot be one itself. */
export const OUTBOUND_MESSAGE_PROVIDER = Symbol("OUTBOUND_MESSAGE_PROVIDER");

export interface OutboundTemplateMessage {
  /**
   * E.164, including the country code — `+919876543210`.
   *
   * ⚠️ Stored and passed WITH the leading `+`. Providers differ on whether they want it, so the
   * stripping (or not) belongs inside each provider rather than at every call site. `wa.me` links
   * in the admin need it removed; the Cloud API accepts it either way.
   */
  toPhoneE164: string;
  /** The approved template's name as registered with the provider. */
  template: string;
  /** Ordered substitutions for the template's `{{1}}`, `{{2}}` … placeholders. */
  variables: string[];
  /** BCP-47 tag of the approved template, e.g. `en` or `en_US`. Meta matches on this. */
  languageCode: string;
}

export interface OutboundSendResult {
  /** The provider's own id, kept so a delivery webhook can be reconciled against the send. */
  providerMessageId: string;
  /** Which provider actually handled it — a log run and a live run must be told apart later. */
  provider: string;
}

/**
 * A send that failed.
 *
 * ⚠️ `retryable` IS THE FIELD THAT MATTERS. A timeout deserves another attempt; "this template
 * does not exist" or "this number is not on WhatsApp" will fail identically forever, and retrying
 * it burns money and delay for nothing. Providers must classify honestly — when in doubt, not
 * retryable, because a lost message is recoverable by a human and a runaway retry loop is not.
 */
export class OutboundSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = "OutboundSendError";
  }
}

export interface OutboundMessageProvider {
  /** Short identifier recorded on the audit trail — "log", "whatsapp-cloud", "gupshup". */
  readonly name: string;

  /**
   * Whether this provider can actually deliver to a human.
   *
   * The logging provider returns false. Callers use it to label the audit trail honestly, so
   * "we sent it" and "we would have sent it" are never confused after the fact.
   */
  readonly canDeliver: boolean;

  /** Throws `OutboundSendError` on failure. Must not retry internally — that is the caller's job. */
  send(message: OutboundTemplateMessage): Promise<OutboundSendResult>;
}
