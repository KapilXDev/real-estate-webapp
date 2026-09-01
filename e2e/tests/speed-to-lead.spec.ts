import { expect, test } from "@playwright/test";

import { whatsappActivityForPhone } from "../support/db";
import { SITE_URL } from "../support/env";
import { E2E_PREFIX, uniqueEmail, uniquePhone } from "../support/marker";

/**
 * The WhatsApp opt-in, from the checkbox a buyer sees to the decision recorded on the lead.
 *
 * ⚠️ THE CONSENT GATE IS UNIT-TESTED IN `apps/api/test/speed-to-lead.spec.ts`. What that CANNOT
 * see is whether the checkbox is even wired up — and it was not: the API has accepted a
 * `whatsappOptIn` flag since the leads module landed, and not one form on the site ever sent it.
 * The gate would therefore have refused every single lead, correctly and invisibly, and the
 * feature would have looked implemented while messaging nobody. That gap lives exactly here,
 * between a form and a database row, which is why this test does too.
 *
 * ⚠️ IT ASSERTS THE DEFAULT IS OFF. A pre-ticked consent box is not consent, and in this market
 * the consequence is not abstract: complaints get a business number removed from WhatsApp, which
 * would cost the agent the channel the whole product is built around. `defaultChecked` is a
 * one-word change somebody will eventually make to "improve conversion", so it is pinned.
 */

test.describe.configure({ mode: "serial" });

test("the consent box is off by default, and the buyer is told what they are agreeing to", async ({
  page,
}) => {
  await page.goto(`${SITE_URL}/contact`);

  const consent = page.locator('input[name="whatsappOptIn"]');
  await expect(consent).toBeVisible();
  await expect(consent, "consent must never be pre-ticked").not.toBeChecked();

  /* Consent to something unspecified is not consent — the buyer has to be told, in words, that a
   * message is coming and who from, before it arrives. */
  const label = page.locator("label", { has: consent });
  await expect(label).toContainText(/WhatsApp/i);
  await expect(label).toContainText(/follow up/i);
  await expect(label, "no way to opt out is stated").toContainText(/STOP/i);
});

test("ticking it produces an acknowledgement attempt on the lead", async ({ page }) => {
  const phone = uniquePhone();

  await page.goto(`${SITE_URL}/contact`);
  const form = page.locator("form").first();
  await form.getByLabel("Name", { exact: true }).fill("Rajvir Kaur Sandhu");
  await form.getByLabel("Email", { exact: true }).fill(uniqueEmail("consent"));
  await form.getByLabel(/^Phone/).fill(phone);
  /* ⚠️ The textbox ROLE, not getByLabel("Message"): the WhatsApp consent copy begins "Message me
   * on WhatsApp…", so a substring label match is ambiguous with the checkbox. */
  await form.getByRole("textbox", { name: "Message" }).fill(`${E2E_PREFIX} browser test enquiry — please ignore.`);
  await page.locator('input[name="whatsappOptIn"]').check();
  await form.getByRole("button", { name: /Send|Submit/ }).click();

  await expect(page.getByRole("heading", { name: /Message sent/i })).toBeVisible();

  /*
   * ⚠️ Polled, because the acknowledgement is deliberately NOT awaited by the request that
   * created the lead — the buyer's 201 must never wait on a messaging provider. So the trail entry
   * lands shortly AFTER the response, and asserting it immediately would be a race.
   */
  await expect
    .poll(async () => (await whatsappActivityForPhone(phone))?.outcome ?? null, {
      timeout: 15_000,
      message: "no speed-to-lead attempt was recorded for a lead that opted in",
    })
    .not.toBeNull();

  const activity = await whatsappActivityForPhone(phone);
  /* "simulated" with the logging provider, "sent" once a real one is configured. Either is a
   * pass; "skipped" would mean consent did not survive the trip from the checkbox. */
  expect(activity?.outcome).not.toBe("skipped");
  /* jsonb object, not a JSON string — postgres.js double-encodes a pre-stringified value and the
   * column silently holds text. It has happened here before, across four columns. */
  expect(activity?.metadataType).toBe("object");
});

test("leaving it unticked records a skip, and says why", async ({ page }) => {
  const phone = uniquePhone();

  await page.goto(`${SITE_URL}/contact`);
  const form = page.locator("form").first();
  await form.getByLabel("Name", { exact: true }).fill("No Consent Buyer");
  await form.getByLabel("Email", { exact: true }).fill(uniqueEmail("noconsent"));
  await form.getByLabel(/^Phone/).fill(phone);
  await form.getByRole("textbox", { name: "Message" }).fill(`${E2E_PREFIX} browser test enquiry — please ignore.`);
  /* Deliberately NOT ticking the box. */
  await form.getByRole("button", { name: /Send|Submit/ }).click();

  await expect(page.getByRole("heading", { name: /Message sent/i })).toBeVisible();

  await expect
    .poll(async () => (await whatsappActivityForPhone(phone))?.reason ?? null, { timeout: 15_000 })
    .toBe("no-consent");

  /*
   * ⚠️ The skip is RECORDED, not silent. Otherwise the agent assumes the buyer has been contacted
   * and the lead goes cold waiting on a message that was never permitted — so the entry has to
   * tell them what to do instead.
   */
  const activity = await whatsappActivityForPhone(phone);
  expect(activity?.body).toContain("Call or email instead");
});
