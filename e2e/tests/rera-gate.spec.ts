import { expect, test } from "@playwright/test";

import { deleteMarkedReraRegistrations } from "../support/db";
import { ADMIN_URL } from "../support/env";
import { E2E_PREFIX, uniqueTitle } from "../support/marker";
import { fillNewListing, listingField } from "../support/listing-form";

/**
 * The RERA publication gate.
 *
 * ⚠️ WHY THIS IS WORTH A BROWSER TEST WHEN THE API ALREADY ENFORCES IT. The enforcement is not
 * the risky part — a 403 is a 403. The risky part is what the agent SEES. A registered agent's
 * number must appear in all advertising and the penalty runs to ₹10 lakh, so the gate will fire
 * on people who are trying to do the right thing and simply have not registered in that
 * jurisdiction yet. If it renders as a bare "Forbidden", the rational response is to assume the
 * tool is broken and go back to posting on WhatsApp.
 *
 * So this asserts the recovery path, not the refusal: the message names the jurisdiction, offers
 * a link straight to the fix, and says plainly that a draft is still allowed.
 *
 * ⚠️ SIGNED IN AS A DIFFERENT TENANT — see the long note on `E2E_ORG`. The dev organisation holds
 * valid Punjab and Chandigarh registrations, so the gate cannot fire for it in any jurisdiction
 * reachable through the form. Expiring one of its real registrations to make the gate fire would
 * mean a crashed run leaves the agent silently unable to publish.
 */

/* The gate organisation's saved session, not the dev one — see `auth.setup.ts` for why it is
 * saved rather than re-established per test. */
test.use({ storageState: "./.auth/gate.json" });

/*
 * ⚠️ SERIAL, and this is load-bearing rather than caution. Two of these tests assert that the
 * organisation has NO Punjab registration, and the third creates one. Run in parallel — or in a
 * different order — the third would make the first two fail with "Registered", which reads as a
 * bug in the gate rather than as test interference. The registration is removed afterwards so the
 * file is re-runnable, and `global-teardown` catches it too if this never runs.
 */
test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await deleteMarkedReraRegistrations();
});

test("all three jurisdictions are listed, and an unregistered one says publishing is blocked", async ({
  page,
}) => {
  await page.goto(`${ADMIN_URL}/rera`);

  /*
   * ⚠️ The tricity spans THREE regulators inside 20 km and that is the single most surprising
   * compliance fact in this market. Silently dropping one from this screen would leave an agent
   * believing a Punjab registration covers Chandigarh, which it does not.
   */
  for (const state of ["Punjab", "Chandigarh", "Haryana"]) {
    await expect(page.getByRole("heading", { name: state, exact: true })).toBeVisible();
  }

  const punjab = page.locator("form").filter({ hasText: "Punjab Real Estate Regulatory Authority" });
  await expect(punjab.getByText("Not registered")).toBeVisible();
  await expect(
    punjab.getByText("You cannot publish listings in Punjab until this is filled in."),
  ).toBeVisible();
  await expect(punjab.getByText("Drafts are always allowed.")).toBeVisible();
});

test("publishing without a registration is refused with a way forward, and a draft still saves", async ({
  page,
}) => {
  const title = uniqueTitle("gate");

  await page.goto(`${ADMIN_URL}/listings/new`);
  await fillNewListing(page, {
    city: "Mohali",
    locality: "Phase 7",
    title,
    price: "1.4 crore",
    areaValue: "9",
    areaUnit: "marla",
    status: "Published",
  });

  /*
   * ⚠️ Scoped to the form. Next renders its own route announcer with `role="alert"` at the top of
   * the document, so a bare `getByRole("alert")` on this app always matches at least one element
   * — which makes both "the error is shown" and "no error is shown" unreliable.
   */
  const banner = page.locator("form").getByRole("alert").first();
  await expect(banner).toContainText("Cannot publish a listing in Punjab");
  await expect(banner).toContainText("save the listing as a draft");

  /* The actionable part. Without this the agent has a wall of legal text and no next step. */
  const fix = banner.getByRole("link", { name: /Add your Punjab RERA registration/ });
  await expect(fix).toBeVisible();
  await expect(fix).toHaveAttribute("href", "/rera");

  /*
   * ⚠️ And the promise the message makes has to be true: a draft is ALWAYS allowed. If this
   * failed, the gate would be blocking an agent from recording inventory they legitimately hold
   * but cannot yet advertise.
   *
   * The whole form is re-filled rather than just switching the status dropdown, because React 19
   * wipes it on a failed action — see the next test, which is the bug report for that.
   */
  await fillNewListing(page, {
    city: "Mohali",
    locality: "Phase 7",
    title,
    price: "1.4 crore",
    areaValue: "9",
    areaUnit: "marla",
    status: "Draft",
  });
  await page.waitForURL(/\/listings\/[0-9a-f-]{36}/);
  /* Exact, because a substring match against a whole page is satisfied by almost anything. The
   * pill deliberately renders the RAW database status — the agent's screens are exactly where
   * DRAFT and PENDING_REVIEW need to be visible. */
  await expect(page.getByText(/^(pending review|draft)$/)).toBeVisible();
});

test("registering the jurisdiction unblocks publishing", async ({ page }) => {
  const title = uniqueTitle("gate then publish");

  await page.goto(`${ADMIN_URL}/listings/new`);
  await fillNewListing(page, {
    city: "Mohali",
    locality: "Phase 7",
    title,
    price: "1.3 crore",
    areaValue: "8",
    areaUnit: "marla",
    status: "Draft",
  });
  await page.waitForURL(/\/listings\/[0-9a-f-]{36}/);
  const listingId = /\/listings\/([0-9a-f-]{36})/.exec(page.url())![1]!;

  await page.goto(`${ADMIN_URL}/rera`);
  const punjab = page.locator("form").filter({ hasText: "Punjab Real Estate Regulatory Authority" });

  /*
   * ⚠️ The registration number carries the E2E marker because that is how teardown finds it. A
   * cleanup keyed on the STATE would delete a real Punjab registration the moment this suite ran
   * against a database that had one — and the agent would discover it as an unexplained
   * publication block. There is deliberately no format validation anywhere in the stack (the
   * three authorities use different, undocumented and changing formats), so a marked number is
   * accepted exactly as typed.
   */
  await punjab.locator('[name="registrationNo"]').fill(`${E2E_PREFIX}-PBRERA-SAS81-AG-0042`);
  await punjab.getByRole("button", { name: "Save" }).click();
  await expect(punjab.getByText("Saved.")).toBeVisible();
  await expect(punjab.getByText("Registered")).toBeVisible();

  await page.goto(`${ADMIN_URL}/listings/${listingId}`);
  await listingField(page, "status").selectOption({ label: "Published" });
  const saved = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes(listingId),
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await saved;

  /* Scoped for the same reason as above — Next's route announcer is also role="alert". */
  await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("active", { exact: true })).toBeVisible();
});

/**
 * ⚠️⚠️ KNOWN BUG, RECORDED AS AN EXPECTED FAILURE — REMOVE `test.fail()` WHEN IT IS FIXED.
 *
 * React 19 RESETS an uncontrolled form after a Server Action completes, and the action completes
 * whether it succeeded or was refused. So a RERA refusal empties every field the agent typed:
 * title, description, address, plot number, area, bedrooms, year built — everything except price,
 * which survives only because it happens to be controlled by `useState` for the price echo.
 *
 * The consequence is bad in proportion to who it hits. The gate fires on agents who are trying to
 * comply and have simply not registered in that jurisdiction yet, and it fires AFTER they have
 * filled in a long form. Being told "add your registration, or save as a draft" and then finding
 * the form blank is how someone decides the tool is not worth using and goes back to WhatsApp.
 *
 * Fixing it means echoing the submitted values back through `ListingFormState` and re-seeding the
 * fields from them — several ways to do that, hence a decision rather than a drive-by fix here.
 */
test("a refused publish keeps what the agent typed", async ({ page }) => {
  /* ⚠️ Called INSIDE the test body on purpose: at file scope, `test.fail()` would mark every
   * test in this file as expected-to-fail, which would hide three real assertions. */
  test.fail(
    true,
    "React 19 resets the form after a Server Action, so a RERA refusal wipes what was typed",
  );

  const title = uniqueTitle("retention");

  await page.goto(`${ADMIN_URL}/listings/new`);
  await fillNewListing(page, {
    city: "Mohali",
    locality: "Phase 7",
    title,
    price: "1.4 crore",
    areaValue: "9",
    areaUnit: "marla",
    status: "Published",
    description: "Corner plot, park facing, south entry.",
  });

  await expect(page.locator("form").getByRole("alert").first()).toContainText(
    "Cannot publish a listing in Punjab",
  );

  await expect(listingField(page, "title")).toHaveValue(title);
  await expect(listingField(page, "description")).toHaveValue(
    "Corner plot, park facing, south entry.",
  );
  await expect(listingField(page, "areaValue")).toHaveValue("9");
});
