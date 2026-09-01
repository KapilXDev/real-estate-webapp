import { Logger, Module, type Provider } from "@nestjs/common";

import { APP_CONFIG, type AppConfig } from "../config/configuration";
import { LoggedOutboundProvider } from "./providers/logged-outbound.provider";
import { OUTBOUND_MESSAGE_PROVIDER } from "./providers/outbound-message.provider";
import { OutboundMessageService } from "./services/outbound-message.service";

/**
 * Outbound messaging.
 *
 * A module of its own rather than something inside `leads/`, because three unrelated features
 * will use it: speed-to-lead now, saved-search alerts and the monthly market email later. The
 * lead-specific policy — who may be messaged, which template, what goes on the audit trail —
 * stays in `leads/services/speed-to-lead.service.ts`; this module only knows how to send.
 */

/**
 * ⚠️ THE BOOT LOG MUST SAY WHETHER MESSAGES ACTUALLY GO ANYWHERE.
 *
 * The single biggest risk with this feature is believing it is live when it is not — the whole
 * design is meant to be indistinguishable from the real thing right up to the network call, which
 * is exactly what makes that mistake easy. So the provider announces itself at startup, and the
 * logging one says plainly that nothing will reach a human.
 */
const providerFactory: Provider = {
  provide: OUTBOUND_MESSAGE_PROVIDER,
  inject: [APP_CONFIG, LoggedOutboundProvider],
  useFactory: (config: AppConfig, logged: LoggedOutboundProvider) => {
    const logger = new Logger("MessagingModule");

    switch (config.MESSAGING_PROVIDER) {
      case "log":
        logger.warn(
          "Outbound messaging provider is 'log' — acknowledgements are RECORDED BUT NOT SENT. " +
            "No buyer will receive anything. Configure a real provider before launch.",
        );
        return logged;
      default:
        /*
         * Unreachable while the config enum has one member, and deliberately present anyway: the
         * day a value is added to the enum without a case here, this throws at boot instead of
         * quietly falling back to the logging provider and dropping every message in production.
         */
        throw new Error(
          `MESSAGING_PROVIDER "${String(config.MESSAGING_PROVIDER)}" has no implementation.`,
        );
    }
  },
};

@Module({
  providers: [LoggedOutboundProvider, providerFactory, OutboundMessageService],
  exports: [OutboundMessageService],
})
export class MessagingModule {}
