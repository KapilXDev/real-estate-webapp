/**
 * Post a lead from the browser, and turn a failure into something worth showing a person.
 *
 * ⚠️ EVERY LEAD FORM ON THE SITE GOES THROUGH HERE, AND THAT IS THE POINT. There are four of
 * them — tour request, contact, home valuation, saved search — and each had its own copy of
 * `if (!response.ok) throw new Error("Request failed")` followed by a hardcoded "Something went
 * wrong". So a fixable mistake in the form and a database outage produced identical wording, and
 * fixing one form's message left the other three wrong.
 *
 * ⚠️ THE DISTINCTION THIS DRAWS IS THE WHOLE VALUE. A 400 is the visitor's own input — a phone
 * number with nine digits instead of ten — and the API says exactly that: "Enter a valid Indian
 * mobile number". Telling them the site is broken instead loses an enquiry on the one page whose
 * entire purpose is capturing one, over a mistake they could have fixed in a second. Anything
 * else really is our problem, and gets the honest fallback that points at the phone number.
 *
 * Returns `null` on success, or a message to put in front of the user.
 */
export async function submitLead(payload: Record<string, unknown>): Promise<string | null> {
  let response: Response;

  try {
    response = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Offline, DNS, a dropped mobile connection mid-submit. Not something a retry of the same
    // form will necessarily fix, so offer the channel that does work.
    return "Could not reach the server. Please check your connection, or call instead.";
  }

  if (response.ok) return null;

  if (response.status === 400) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return body.error ?? "Please check the details you entered and try again.";
  }

  return "Something went wrong. Please try again, or call instead.";
}
