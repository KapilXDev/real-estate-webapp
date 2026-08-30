import { expect, test } from "@playwright/test";

import { ADMIN_URL, SITE_URL } from "../support/env";
import { E2E_PREFIX, uniqueEmail, uniquePhone } from "../support/marker";

/**
 * A buyer enquires on the site; the agent finds it in the admin and can answer it.
 *
 * ⚠️ THE ONLY REVENUE PATH IN THE PRODUCT. Everything else — search, photos, locality guides —
 * exists to produce this one event, and it crosses three processes: the site's form, the API's
 * scoring and tenant routing, and the admin's follow-up queue. Each of those is covered by unit
 * or integration tests in isolation; nothing else asserts that they are wired to each other.
 *
 * ⚠️ WHATSAPP IS THE PRIMARY ACTION, NOT EMAIL, and that is a market fact rather than a style
 * choice. It is why `phone` outweighs every property attribute in the lead score. The `wa.me`
 * link is asserted precisely because it fails silently: the number is stored E.164 (+91…) and
 * wa.me needs it with no `+` and no separators. Passing the stored value straight through opens
 * WhatsApp to a BLANK CHAT, which the agent reads as a wrong number rather than as a bad link.
 */

/* Serial: the second test follows up on the enquiry the first one creates. Sharing state between
 * tests is usually a smell, but splitting "an enquiry arrives" from "the agent works it" keeps two
 * genuinely different failures apart, and creating a second identical buyer would exercise the
 * contact-deduplication path instead of the one under test. */
test.describe.configure({ mode: "serial" });

const BUYER = {
  name: "E2E Test Buyer",
  /* Reserved by RFC 2606, and the marker teardown keys on the domain. */
  email: uniqueEmail("buyer"),
  /* ⚠️ Randomised, because an enquiry is deduplicated onto an existing contact BY PHONE — see
   * `uniquePhone`. A fixed number silently attaches the test's enquiry to somebody else's record. */
  phone: uniquePhone(),
};

test("an enquiry from the site reaches the agent's queue, ready to answer on WhatsApp", async ({
  page,
  context,
}) => {
  await page.goto(`${SITE_URL}/search`);
  await page.locator('a[href^="/listings/"]').first().click();
  await page.waitForURL(/\/listings\/[0-9a-f-]{36}/);

  const listingUrl = page.url();

  /* Scoped to the tour form: the listing page carries more than one lead capture, and a bare
   * getByLabel("Email") would be ambiguous the moment another is added. */
  const form = page.locator("section").filter({ hasText: "Schedule a tour" });
  await form.getByLabel("Name", { exact: true }).fill(BUYER.name);
  await form.getByLabel("Email", { exact: true }).fill(BUYER.email);
  await form.getByLabel(/^Phone/).fill(BUYER.phone);
  /* The message is prefilled with the address; the marker replaces it so teardown can find this
   * enquiry even if it ends up attached to a pre-existing contact. */
  await form.getByLabel("Message").fill(`${E2E_PREFIX} browser test enquiry — please ignore.`);
  await form.getByRole("button", { name: "Request a tour" }).click();

  /* The buyer's confirmation. A form that silently succeeds is a form people submit twice. */
  await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();

  const admin = await context.newPage();
  await admin.goto(`${ADMIN_URL}/leads`);

  /* Located by PHONE, which is the identity the product actually keys on, and the thing the
   * agent will use to answer. */
  const row = admin.locator("li").filter({ hasText: BUYER.phone });
  await expect(row, "the enquiry never reached the agent's queue").toBeVisible();

  /* Triage information: what they want, and how reachable they are. */
  await expect(row).toContainText("Wants a viewing");
  await expect(row).toContainText(BUYER.email);

  /*
   * ⚠️ The `+` and any separators must be gone. This is the assertion that catches a blank chat.
   */
  const whatsapp = row.getByRole("link", { name: "WhatsApp" });
  await expect(whatsapp).toHaveAttribute(
    "href",
    `https://wa.me/${BUYER.phone.replace(/\D/g, "")}`,
  );
  await expect(whatsapp).toHaveAttribute("target", "_blank");
  /* `noopener` — without it the opened tab can rewrite this one via window.opener, and this tab
   * is an authenticated admin session. */
  await expect(whatsapp).toHaveAttribute("rel", /noopener/);

  /* The enquiry links back to the property that triggered it, not just "someone enquired". */
  const listingId = /\/listings\/([0-9a-f-]{36})/.exec(listingUrl)![1]!;
  await expect(row.getByRole("link", { name: "About one of your listings" })).toHaveAttribute(
    "href",
    `/listings/${listingId}`,
  );
});

test("status changes on an enquiry stick", async ({ page }) => {
  await page.goto(`${ADMIN_URL}/leads`);

  const row = page.locator("li").filter({ hasText: BUYER.phone }).first();
  await expect(row).toBeVisible();

  /* Optimistic in the UI and reverted if the server disagrees — so a reload is the only honest
   * way to tell whether it was actually written. */
  await row.getByLabel("Status").selectOption("CONTACTED");
  await expect(row.getByRole("alert")).toHaveCount(0);

  await page.reload();
  const reloaded = page.locator("li").filter({ hasText: BUYER.phone }).first();
  await expect(reloaded.getByLabel("Status")).toHaveValue("CONTACTED");
});

/**
 * A mistyped phone number is the visitor's mistake, and the form has to say so.
 *
 * ⚠️ EVERY FAILURE USED TO BECOME THE SAME 500 AND THE SAME "Could not save your request. Please
 * call or email instead." So someone who typed nine digits instead of ten was told the site was
 * broken — on the one page whose entire purpose is capturing a lead, with no hint that the fix was
 * one character in a field they could see. An error message was losing enquiries.
 *
 * Asserted at both layers because they fail differently: the route has to answer 400 with the
 * reason rather than 500 with an apology, and the form has to actually render it.
 */
test("a mistyped phone number is reported to the buyer, not swallowed as an outage", async ({
  page,
  request,
}) => {
  /* Nine digits after +91. The API wants ten, starting 6-9. */
  const tooShort = await request.post(`${SITE_URL}/api/leads`, {
    data: {
      type: "contact",
      name: "E2E Test Buyer",
      email: uniqueEmail("badphone"),
      phone: "+91987650012",
      message: `${E2E_PREFIX} browser test enquiry — please ignore.`,
    },
  });

  expect(tooShort.status(), "a correctable mistake must not present as a server outage").toBe(400);
  expect(await tooShort.text()).toContain("Enter a valid Indian mobile number");

  /* And the form in front of a real person shows that wording rather than the generic fallback. */
  await page.goto(`${SITE_URL}/contact`);
  const form = page.locator("form").first();
  await form.getByLabel("Name", { exact: true }).fill("E2E Test Buyer");
  await form.getByLabel("Email", { exact: true }).fill(uniqueEmail("badphone-ui"));
  await form.getByLabel(/^Phone/).fill("+91987650012");
  await form.getByLabel("Message").fill(`${E2E_PREFIX} browser test enquiry — please ignore.`);
  await form.getByRole("button", { name: /Send|Submit/ }).click();

  /* Scoped to the form: Next renders a route announcer with `role="alert"` at document level, so
   * a bare getByRole("alert") is ambiguous on every page of this app. */
  await expect(form.getByRole("alert")).toContainText("Enter a valid Indian mobile number");
});
