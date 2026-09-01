import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config/configuration";
import type { TenantContext } from "../src/database/database.service";
import type { LeadRepository } from "../src/leads/repositories/lead.repository";
import { SpeedToLeadService, firstName } from "../src/leads/services/speed-to-lead.service";
import { OutboundMessageService } from "../src/messaging/services/outbound-message.service";
import {
  OutboundSendError,
  type OutboundMessageProvider,
  type OutboundTemplateMessage,
} from "../src/messaging/providers/outbound-message.provider";

/**
 * Speed-to-lead policy.
 *
 * ⚠️ NO DATABASE, UNLIKE EVERY OTHER SUITE IN THIS DIRECTORY. What is under test here is a set of
 * decisions — may we message this person, which template, how many times do we retry, what gets
 * written down — and all of it is expressible with fakes. Routing it through Postgres would make
 * the suite slower and the assertions less direct without testing anything extra; the repository
 * call it makes is already covered by the RLS suites.
 *
 * ⚠️ THE CONSENT TESTS ARE THE IMPORTANT ONES. Messaging someone in India who did not opt in is a
 * regulatory problem and a fast route to WhatsApp banning the agent's number — which would cost
 * them the primary channel this whole market runs on. "It failed closed" has to be provable, not
 * assumed, so each way of lacking consent gets its own test rather than one combined case.
 */

const CONTEXT: TenantContext = { organizationId: "org-1" };

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    SPEED_TO_LEAD_ENABLED: true,
    SPEED_TO_LEAD_TEMPLATE: "lead_acknowledgement",
    SPEED_TO_LEAD_TEMPLATE_LANGUAGE: "en",
    OUTBOUND_MAX_ATTEMPTS: 3,
    // Zero backoff: the retry COUNT is the behaviour under test, the waiting is not.
    OUTBOUND_RETRY_BASE_MS: 0,
    ...overrides,
  } as AppConfig;
}

/** Records what it was asked to send, and fails however the test tells it to. */
function fakeProvider(
  behaviour: { fail?: OutboundSendError | Error; failTimes?: number; canDeliver?: boolean } = {},
) {
  const sent: OutboundTemplateMessage[] = [];
  let calls = 0;

  const provider: OutboundMessageProvider = {
    name: "fake",
    canDeliver: behaviour.canDeliver ?? true,
    send(message) {
      calls += 1;
      sent.push(message);
      if (behaviour.fail && calls <= (behaviour.failTimes ?? Number.POSITIVE_INFINITY)) {
        return Promise.reject(behaviour.fail);
      }
      return Promise.resolve({ providerMessageId: `fake:${calls}`, provider: "fake" });
    },
  };

  /* ⚠️ A function, not a getter. `build()` below spreads this object, and spreading EVALUATES a
   * getter once — so a `get calls()` would be frozen at 0 and every send assertion would fail
   * while the code under test was perfectly fine. */
  return { provider, sent, callCount: () => calls };
}

function fakeRepository() {
  const activities: { type: string; body?: string; metadata?: Record<string, unknown> }[] = [];
  const repository = {
    recordActivity: vi.fn(async (input: { type: string; body?: string; metadata?: Record<string, unknown> }) => {
      activities.push(input);
    }),
  } as unknown as LeadRepository;
  return { repository, activities };
}

function build(
  providerBehaviour?: Parameters<typeof fakeProvider>[0],
  configOverrides?: Partial<AppConfig>,
) {
  const cfg = config(configOverrides);
  const p = fakeProvider(providerBehaviour);
  const outbound = new OutboundMessageService(p.provider, cfg);
  const r = fakeRepository();
  const service = new SpeedToLeadService(outbound, r.repository, cfg);
  return { service, ...p, ...r };
}

const LEAD = {
  leadId: "lead-1",
  organizationId: "org-1",
  organizationName: "Tricity Estate",
  contactName: "Rajvir Kaur Sandhu",
  phoneE164: "+919876543210",
  whatsappOptIn: true,
  listingLabel: "Kothi in Phase 7, Mohali",
};

describe("consent", () => {
  it("does not message a contact who did not opt in", async () => {
    const t = build();

    await t.service.acknowledge({ ...LEAD, whatsappOptIn: false }, CONTEXT);

    expect(t.callCount(), "a message was sent without consent").toBe(0);
    expect(t.activities[0]?.metadata).toMatchObject({ outcome: "skipped", reason: "no-consent" });
  });

  it("does not message a contact with no phone number", async () => {
    const t = build();

    await t.service.acknowledge({ ...LEAD, phoneE164: undefined }, CONTEXT);

    expect(t.callCount()).toBe(0);
    expect(t.activities[0]?.metadata).toMatchObject({ outcome: "skipped", reason: "no-phone" });
  });

  it("sends nothing at all when the feature is switched off", async () => {
    const t = build(undefined, { SPEED_TO_LEAD_ENABLED: false });

    await t.service.acknowledge(LEAD, CONTEXT);

    expect(t.callCount()).toBe(0);
    expect(t.activities[0]?.metadata).toMatchObject({ outcome: "skipped", reason: "disabled" });
  });

  it("records the skip on the lead rather than staying silent", async () => {
    const t = build();

    await t.service.acknowledge({ ...LEAD, whatsappOptIn: false }, CONTEXT);

    /* The agent has to be able to see that nothing was sent, and why — otherwise they assume the
     * buyer has been contacted and the lead goes cold waiting on a message that never went. */
    expect(t.activities[0]?.type).toBe("WHATSAPP");
    expect(t.activities[0]?.body).toContain("Call or email instead");
  });
});

describe("the message", () => {
  it("sends the configured template with the variables in the order the template expects", async () => {
    const t = build();

    await t.service.acknowledge(LEAD, CONTEXT);

    expect(t.callCount()).toBe(1);
    expect(t.sent[0]).toEqual({
      toPhoneE164: "+919876543210",
      template: "lead_acknowledgement",
      languageCode: "en",
      /* ⚠️ POSITIONAL. WhatsApp placeholders are {{1}}, {{2}}, {{3}} with no names, so a
       * reordering here silently swaps the buyer's name for the property in a live message. */
      variables: ["Rajvir", "Tricity Estate", "Kothi in Phase 7, Mohali"],
    });
  });

  it("uses the first name only", async () => {
    /* "Hi Rajvir" reads like a person; the full legal name reads like a mail merge, which is the
     * one impression this message must not give. */
    expect(firstName("Rajvir Kaur Sandhu")).toBe("Rajvir");
    expect(firstName("  Amit  ")).toBe("Amit");
    /* Meta rejects an empty template variable outright, so a blank name must fall back. */
    expect(firstName("   ")).toBe("there");
  });

  it("falls back when the enquiry names no property", async () => {
    const t = build();

    await t.service.acknowledge({ ...LEAD, listingLabel: undefined }, CONTEXT);

    expect(t.sent[0]?.variables[2]).toBe("your enquiry");
  });
});

describe("failure handling", () => {
  it("retries a retryable failure and succeeds", async () => {
    const t = build({ fail: new OutboundSendError("timeout", true), failTimes: 2 });

    await t.service.acknowledge(LEAD, CONTEXT);

    expect(t.callCount()).toBe(3);
    expect(t.activities[0]?.metadata).toMatchObject({ outcome: "sent", attempts: 3 });
  });

  it("does NOT retry a permanent rejection", async () => {
    /* Every WhatsApp conversation is billed, and "template not found" fails identically forever.
     * Retrying it spends money and delays the fallback to a human for nothing. */
    const t = build({ fail: new OutboundSendError("template not found", false) });

    await t.service.acknowledge(LEAD, CONTEXT);

    expect(t.callCount(), "a permanent rejection was retried").toBe(1);
    expect(t.activities[0]?.metadata).toMatchObject({ outcome: "failed", attempts: 1 });
  });

  it("gives up after the configured number of attempts", async () => {
    const t = build({ fail: new OutboundSendError("timeout", true) });

    await t.service.acknowledge(LEAD, CONTEXT);

    expect(t.callCount()).toBe(3);
    expect(t.activities[0]?.metadata).toMatchObject({ outcome: "failed", attempts: 3 });
  });

  it("treats an unclassified error as retryable", async () => {
    /* A plain Error means the provider did not tell us — a network stack throwing TypeError, say.
     * Retrying is the safer read: the cost is a duplicate at worst, versus a lost lead. */
    const t = build({ fail: new Error("socket hang up"), failTimes: 1 });

    await t.service.acknowledge(LEAD, CONTEXT);

    expect(t.callCount()).toBe(2);
    expect(t.activities[0]?.metadata).toMatchObject({ outcome: "sent" });
  });

  it("never throws, even when writing the audit trail fails", async () => {
    /*
     * ⚠️ THE MOST IMPORTANT TEST IN THE FILE. This runs unawaited off the lead-creation path. An
     * escaping rejection would be an unhandled promise rejection, which under Node's default
     * policy takes the process down — an optional feature killing the API that just accepted a
     * lead. Whatever breaks in here, it must not leave this method.
     */
    const t = build();
    (t.repository.recordActivity as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("database is on fire"),
    );

    await expect(t.service.acknowledge(LEAD, CONTEXT)).resolves.toBeUndefined();
  });
});

describe("honesty about what actually happened", () => {
  it("does not claim delivery when the provider cannot deliver", async () => {
    /*
     * ⚠️ The logging provider exists so the machinery can be built and tested before an account
     * exists — and the single risk it carries is someone believing messages are going out. The
     * trail must therefore never say "sent" when nothing left the building.
     */
    const t = build({ canDeliver: false });

    await t.service.acknowledge(LEAD, CONTEXT);

    expect(t.activities[0]?.metadata).toMatchObject({ outcome: "simulated" });
    expect(t.activities[0]?.body).toContain("NOT sent");
  });

  it("records which provider handled it and how many attempts it took", async () => {
    const t = build();

    await t.service.acknowledge(LEAD, CONTEXT);

    expect(t.activities[0]?.metadata).toMatchObject({
      provider: "fake",
      attempts: 1,
      template: "lead_acknowledgement",
      providerMessageId: "fake:1",
    });
  });
});
