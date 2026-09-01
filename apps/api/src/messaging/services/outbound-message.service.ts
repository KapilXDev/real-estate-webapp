import { Inject, Injectable, Logger } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../../config/configuration";
import {
  OUTBOUND_MESSAGE_PROVIDER,
  OutboundSendError,
  type OutboundMessageProvider,
  type OutboundSendResult,
  type OutboundTemplateMessage,
} from "../providers/outbound-message.provider";
import { maskPhone } from "../providers/logged-outbound.provider";

export interface OutboundAttempt {
  ok: boolean;
  provider: string;
  /** False for the logging provider — "recorded" is not "delivered". */
  delivered: boolean;
  providerMessageId?: string;
  error?: string;
  attempts: number;
}

/**
 * Retry policy, and the only place a provider is called from.
 *
 * ⚠️ THIS NEVER THROWS. Everything above it is on the revenue path: the lead is already committed
 * and the buyer is already looking at a thank-you screen. An exception escaping here could only
 * ever turn a successful enquiry into an error, which is the exact trade this feature must never
 * make. Failures come back as a value, get written to the lead's trail, and a human follows up —
 * which is what would have happened anyway before any of this existed.
 *
 * ⚠️ ONLY RETRYABLE FAILURES ARE RETRIED, and that distinction is worth money. A timeout is worth
 * another attempt; "template not found" or "not a WhatsApp number" fails identically forever, and
 * every WhatsApp conversation is billed. Retrying a permanent rejection three times spends three
 * times nothing and delays the fallback to a human by the length of the backoff.
 *
 * Backoff is short on purpose. The entire value of speed-to-lead is measured in the first minute
 * or two, so a patient exponential schedule would be self-defeating: better to fail fast, record
 * it, and let the agent see an unanswered lead in the queue.
 */
@Injectable()
export class OutboundMessageService {
  private readonly logger = new Logger(OutboundMessageService.name);

  constructor(
    @Inject(OUTBOUND_MESSAGE_PROVIDER) private readonly provider: OutboundMessageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** True when the configured provider can actually reach a person. */
  get canDeliver(): boolean {
    return this.provider.canDeliver;
  }

  async send(message: OutboundTemplateMessage): Promise<OutboundAttempt> {
    const maxAttempts = this.config.OUTBOUND_MAX_ATTEMPTS;
    let lastError = "unknown error";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result: OutboundSendResult = await this.provider.send(message);
        return {
          ok: true,
          provider: result.provider,
          delivered: this.provider.canDeliver,
          providerMessageId: result.providerMessageId,
          attempts: attempt,
        };
      } catch (error) {
        const retryable = error instanceof OutboundSendError ? error.retryable : true;
        lastError =
          error instanceof Error ? error.message : `non-Error thrown: ${String(error)}`;

        if (!retryable) {
          this.logger.warn(
            `Outbound "${message.template}" to ${maskPhone(message.toPhoneE164)} rejected ` +
              `permanently after ${attempt} attempt(s): ${lastError}`,
          );
          return {
            ok: false,
            provider: this.provider.name,
            delivered: false,
            error: lastError,
            attempts: attempt,
          };
        }

        if (attempt < maxAttempts) {
          // 400ms, 800ms, 1600ms … deliberately impatient; see the note above.
          await delay(this.config.OUTBOUND_RETRY_BASE_MS * 2 ** (attempt - 1));
        }
      }
    }

    this.logger.warn(
      `Outbound "${message.template}" to ${maskPhone(message.toPhoneE164)} failed after ` +
        `${maxAttempts} attempt(s): ${lastError}`,
    );
    return {
      ok: false,
      provider: this.provider.name,
      delivered: false,
      error: lastError,
      attempts: maxAttempts,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
