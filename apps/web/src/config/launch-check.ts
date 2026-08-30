import { site } from "./site";

/**
 * Refuses to launch with placeholder agent details still in `config/site.ts`.
 *
 * ⚠️ WHY THIS IS A HARD FAILURE AND NOT A WARNING.
 *
 * Under RERA, a registered agent's registration number must appear in ALL advertising, and a
 * website is advertising. The penalty runs to ₹10 lakh. Every one of those fields ships as an
 * obvious placeholder — `"Your Name"`, `"+91 98765 43210"`, `"PBRERA-XXXXX"` — and placeholders
 * are invisible in exactly the situation that matters: the site looks finished, the footer renders
 * a registration line, and the number in it is fictitious. That is worse than showing nothing,
 * because a fabricated registration number reads as verified until someone checks the register.
 *
 * A console warning would be seen by nobody. This throws, so a build or boot that would advertise
 * fake credentials fails instead — noisy, unmissable, and fixed by filling in one config file.
 *
 * ⚠️ GATED ON `NEXT_PUBLIC_SITE_URL`, not on NODE_ENV. `next build` runs with NODE_ENV=production
 * for every preview and every CI check, and blocking those would make the check something people
 * route around. The site URL is only set when the site is actually being served to the public —
 * the same signal `robots.ts` already uses to decide whether indexing is allowed.
 */

/** Substrings that mark a value as never-edited. Matched case-insensitively. */
const PLACEHOLDER_MARKERS = [
  "your name",
  "your firm",
  "98765 43210",
  "9876543210",
  "xxxxx",
  "example.com",
  "placeholder",
  "tbd",
  "todo",
];

function looksLikePlaceholder(value: string | undefined | null): boolean {
  if (!value) return true;
  const normalised = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => normalised.includes(marker));
}

export interface LaunchProblem {
  field: string;
  value: string;
  why: string;
}

/**
 * Everything that must be real before the site faces the public.
 *
 * Returned rather than thrown so a status page or a CI step can render the whole list at once —
 * finding these one exception at a time would be miserable.
 */
export function findLaunchBlockers(): LaunchProblem[] {
  const problems: LaunchProblem[] = [];

  const check = (field: string, value: string | undefined, why: string): void => {
    if (looksLikePlaceholder(value)) {
      problems.push({ field, value: value ?? "(unset)", why });
    }
  };

  check("site.agent.name", site.agent.name, "Named in every listing attribution and the footer.");
  check(
    "site.agent.phone",
    site.agent.phone,
    "The click-to-call target. A placeholder number sends buyers to a stranger.",
  );
  check(
    "site.agent.whatsapp",
    site.agent.whatsapp,
    "WhatsApp is the primary lead channel in this market — a wrong number loses every enquiry.",
  );
  check("site.firm.name", site.firm.name, "Rendered as 'Courtesy of{firm}' on every listing card.");

  /*
   * ⚠️ RERA IS CHECKED PER JURISDICTION, not once.
   *
   * The tricity spans Punjab RERA (Mohali, Kharar, Zirakpur, New Chandigarh) and Chandigarh's own
   * separate authority — and Haryana's if the agent works Panchkula. Holding one registration and
   * advertising property under all three is the failure this loop exists to catch, and it is easy
   * to miss because the site looks entirely correct with a single number filled in.
   */
  const byState = site.rera.byState as Record<string, { registration?: string } | undefined>;
  for (const [state, registration] of Object.entries(byState)) {
    check(
      `site.rera.byState.${state}.registration`,
      registration?.registration,
      `${state} is a separate RERA authority. Advertising property there without its own ` +
        `registration is a compliance failure, not a display issue.`,
    );
  }

  return problems;
}

/**
 * Throw if the site is being served publicly with placeholders still in place.
 *
 * Called from `app/layout.tsx`, which every page renders through — so there is no route that can
 * quietly bypass it.
 */
export function assertReadyForLaunch(): void {
  // Not public yet: robots.ts is returning Disallow: /, so nothing here is being advertised.
  if (!process.env.NEXT_PUBLIC_SITE_URL) return;

  // An explicit escape hatch, because someone will legitimately need to preview the real domain
  // before the details land. Deliberately verbose to type and impossible to set by accident.
  if (process.env.ALLOW_PLACEHOLDER_AGENT_DETAILS === "i-understand-this-is-not-compliant") return;

  const problems = findLaunchBlockers();
  if (problems.length === 0) return;

  const detail = problems.map((p) => `  • ${p.field} = "${p.value}"\n    ${p.why}`).join("\n");

  throw new Error(
    `Refusing to serve a public site with placeholder agent details.\n\n${detail}\n\n` +
      `A website is advertising under RERA, and a registered agent's number must appear on it. ` +
      `Fill these in at apps/web/src/config/site.ts.\n\n` +
      `To preview anyway (NOT for a live site), set ` +
      `ALLOW_PLACEHOLDER_AGENT_DETAILS=i-understand-this-is-not-compliant.`,
  );
}
