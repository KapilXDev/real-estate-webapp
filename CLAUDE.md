# Real Estate Agent Website — Project Context

> **Resuming in a fresh session? Read this file, then `docs/BUILD_LOG.md`.**
> Between them you have the full plan and the exact current state. You should not need to
> re-explore the codebase or redo research to continue.

## What this is

A production website for a working realtor. Not a brochure site — the goal is a buyer-facing
property search experience plus a lead-capture engine, competitive with what the big portals offer.

The user is a realtor, **not a developer**. Explain trade-offs in business terms (leads, conversion,
ranking, cost), not implementation detail.

## Decisions already made (do not re-litigate)

| Decision | Value |
|---|---|
| Lead priority | **70% buyers / 30% sellers** — buyer search wins effort trade-offs |
| Scope | **Full build, phased** (see Phases below) |
| IDX/MLS feed | **Status unknown** — user hasn't asked broker yet. Hard external blocker. |
| Market area | **Not yet provided** — neighborhoods are config-driven until it is |
| Stack | Next.js App Router + TypeScript + Tailwind + MapLibre |

## The IDX constraint (most important thing to understand)

Live MLS listings legally require a **signed IDX agreement with the MLS board, via the broker**.
This is a licensing gate, not a technical one, and it is not yet cleared.

**Therefore:** all listing data flows through a `ListingProvider` interface. A mock/sample provider
backs it today so the entire buyer-side UI is buildable and demoable now. When the feed is approved,
a `ResoProvider` (RESO Web API — REST/JSON, replaced RETS ~2020) is swapped in behind the same
interface with **no UI changes**.

**Compliance, once the feed is live** — build into the shared listing-card component so it is
structurally impossible to omit:
- Broker attribution "Courtesy of [Listing Broker]" on **every** view — search cards and map
  thumbnails too, not just detail pages
- Board's verbatim MLS disclaimer + copyright line
- Equal Housing Opportunity logo, agent license number
- Last-updated timestamp; feed refresh every 12–24 hours minimum

NAR's 2026 handbook overhaul removed the model $15,000 penalty cap — boards have wide latitude, so
treat compliance as non-optional.

## Phases — current status

- **Phase 1 — COMPLETE.** Home, search, listing detail, neighborhoods (hub + guides), home-value
  seller funnel, own listings, about, contact, mortgage calculator, market reports, sitemap,
  robots, JSON-LD. Launchable pending real content.
- **Phase 2 — MOSTLY DONE AHEAD OF SCHEDULE.** Built: map search w/ polygon draw, full filter
  set, saved-search capture, lead store + scoring. Remaining: user accounts + favorites, and
  actually *sending* listing alerts (needs an email provider). IDX swap still gated on the feed.
- **Phase 3 — NOT STARTED.** AI natural-language search, grounded concierge chatbot,
  speed-to-lead auto-SMS (TODO marker lives in `src/app/api/leads/route.ts`), automated
  market-report emails.

## Gotchas worth knowing before you edit

- **Tailwind v4** generates utilities from `@theme` tokens: use `bg-status-active`,
  `rounded-card` — NOT v3-style `bg-[--color-status-active]`.
- **maplibre-gl v6 has no default export.** Use named imports (`MapLibreMap`, `Marker`,
  `NavigationControl`, `LngLatBounds`). A default import fails the Turbopack build.
- **MapLibre can't be server-rendered** (touches `window` at module scope). It loads via
  `MapPanel.tsx`, a client wrapper doing `dynamic(..., { ssr: false })`.
- **Large TSX files fail through bash heredocs** in this environment — use the Write tool.
- **Counting elements in `curl` output?** Everything appears ~2x because Next embeds the RSC
  flight payload beside the SSR markup. Divide by two.

## Why these features (research-backed, 2026)

- Home valuation landing pages convert at **5–15%** vs 0.5–1.5% for standard pages → seller funnel
  is small effort, outsized return.
- **Saved searches + instant alerts** are the most-requested feature by serious buyers, and the best
  gated-signup trigger (people trade email for alerts willingly).
- **72% of buyer queries name a specific neighborhood**; portals don't rank well for those. Hyperlocal
  neighborhood pages (target 40+) are the only realistic organic-traffic path for a solo agent.
  Takes 6–12 months to rank → start early.
- **Speed-to-lead** auto-response within 60–90 seconds is the highest-ROI automation available.
- Polygon draw ("this side of the highway only") expresses intent no dropdown filter can.

**Explicitly out of scope:** own AVM/Zestimate clone (liability, and a valuation *form* routing to a
real CMA converts better anyway), rental/tenant portals, transaction management, e-signature.

## Conventions

- Server Components by default; client components only for map + interactive filters.
- Listing/neighborhood pages must be server-rendered and crawlable (SEO is a core feature here).
- Never hardcode neighborhoods or agent details — they live in config so the realtor can edit them.
- Target LCP < 2.5s; it's a direct ranking factor for this site's core purpose.

## Open questions for the user

1. **Market area + neighborhoods worked** — needed for real neighborhood pages (currently placeholder).
2. **IDX status** — has the broker been asked yet?
3. Agent name, brokerage, license #, photo, contact details for the real content pass.
