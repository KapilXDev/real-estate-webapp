import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import {
  type OutboundMessageProvider,
  type OutboundSendResult,
  type OutboundTemplateMessage,
} from "./outbound-message.provider";

/**
 * The default provider: writes what would have been sent, and sends nothing.
 *
 * ⚠️ `canDeliver` IS FALSE, AND THAT HONESTY IS THE ENTIRE POINT OF THIS CLASS. The original TODO
 * in `LeadService` argued that a stub logging "would have sent" is worse than nothing, because it
 * looks done in review. It is right about the risk and wrong about the conclusion: the danger is
 * not the stub, it is a stub that is indistinguishable from the real thing. So every trace this
 * leaves says `delivered: false` and names the provider as `log`, the admin shows the difference,
 * and the boot log says plainly that no messages will reach anyone.
 *
 * What that buys is everything around the network call — consent, template selection, retry
 * classification, the audit trail, "never block the response" — built and tested now, so adding a
 * real provider is one class and one environment variable rather than a redesign.
 *
 * ⚠️ THE PHONE NUMBER IS NOT LOGGED IN FULL. These logs are read during development, shipped to
 * whatever aggregator gets configured, and kept far longer than anyone intends. A buyer's mobile
 * number is the single most sensitive thing this system holds about them — it is the one channel
 * that reaches them personally — and it has no business sitting in plaintext in a log aggregator.
 */
@Injectable()
export class LoggedOutboundProvider implements OutboundMessageProvider {
  readonly name = "log";
  readonly canDeliver = false;

  private readonly logger = new Logger(LoggedOutboundProvider.name);

  send(message: OutboundTemplateMessage): Promise<OutboundSendResult> {
    this.logger.log(
      `[not sent] template "${message.template}" (${message.languageCode}) ` +
        `to ${maskPhone(message.toPhoneE164)} with [${message.variables.join(" | ")}]`,
    );

    return Promise.resolve({
      // A real id shape so anything downstream that keys on it is exercised properly.
      providerMessageId: `log:${randomUUID()}`,
      provider: this.name,
    });
  }
}

/** `+919876543210` → `+91·····3210`. Enough to correlate two log lines, not enough to call anyone. */
export function maskPhone(e164: string): string {
  if (e164.length <= 7) return "·".repeat(e164.length);
  return `${e164.slice(0, 3)}${"·".repeat(e164.length - 7)}${e164.slice(-4)}`;
}
