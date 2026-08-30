# Tricity Estate — Project Context

> **Resuming in a fresh session? Read this file, then `docs/BUILD_LOG.md`.**
> Between them you have the full plan and the exact current state. You should not need to
> re-explore the codebase or redo research to continue.

## What this is

A production property platform for the **Chandigarh / Mohali / Kharar tricity market (India)**.
Buyer-facing property search plus a lead-capture engine, backed by a multi-tenant NestJS API that
partner brokers post their own inventory into.

The user is a **software developer**. Discuss architecture-level trade-offs directly, and get
approval before large structural changes or installing dependencies.

## ⚠️ There is no MLS in India

**This is the single most important thing to understand, and it reverses the original plan.**

The build began as a US realtor site organised entirely around an IDX/MLS feed. That premise is
**void**. India has no MLS, no IDX, no RESO Web API, no cooperative listing database. Anything in
the history referencing RESO, IDX, broker attribution or NAR is dead — see ADR-001 and the Step 7
entry in the build log.

**Consequences that still shape the code:**

- **Inventory sourcing is the hardest unsolved problem in this project**, not a licensing formality.
  Agreed sources: the agent's own listings, builder/developer project inventory, and a partner
  broker network. Portal scraping (99acres/MagicBricks) was explicitly rejected — ToS and legal risk.
- `ListingProvider` still exists as a seam, but for a *different reason*: several unrelated
  inventory sources that will never share a schema. `MockProvider` today → `ApiProvider` next.
  Env var is `LISTING_PROVIDER` (renamed from `MLS_PROVIDER`).
- **RERA replaces NAR/IDX as the compliance regime.**

## RERA compliance (build it in structurally)

A registered agent's RERA number must appear in **all** advertising, and a website is advertising.
Penalty up to **₹10 lakh**.

**⚠️ The agent spans TWO jurisdictions** — this is not a detail:
- **Punjab RERA** — Mohali, Kharar, Zirakpur, New Chandigarh
- **Chandigarh** — a Union Territory with its **own separate authority**
- (Haryana/HRERA Panchkula if they work there — a third)

A single registration does not cover both. `site.rera.byState` is keyed on the `state` field from
`@tricity/geo`, and `reraForState()` resolves the right one per listing.

Rendered unconditionally by `ListingAttribution` (every card, every view) and `SiteFooter`. Do not
add a prop to hide either. While `isLiveData` is false, listings are labelled sample data instead —
printing registrations over fabricated inventory would be its own advertising problem.

## India-specific correctness (lives in `@tricity/domain`)

Never re-implement these at a call site; import them.

- **Money:** INR, **lakh/crore** — `formatPriceShort` ("₹1.25 Cr") is the DEFAULT display, not a
  fallback. `parsePriceInput` accepts "85 lakh"/"1.25cr" because agents type that; misreading it is
  a 10⁵ error. Indian digit grouping (`en-IN`): 85,00,000 not 8,500,000.
- **Area:** Punjab **marla = 272.25 sq ft**, **kanal = 5,445 sq ft** (20 marla), gaj = sq yd.
  Marla is regionally ambiguous, so **the conversion factor is stored per row** and `fromStored()`
  rehydrates with it — historical listings never silently shift.
- **Carpet area is the RERA basis** for under-construction sale, not super/built-up. Where present
  it leads.
- Property types: plot, kothi, builder floor, flat, villa, SCO/SCF/booth, farmhouse. **Plots are
  first-class** — a large share of transactions are bare land.
- **Possession status** (ready-to-move / under-construction / new-launch) is used ahead of almost
  everything but price. **BHK** is the unit of account for homes.
- **Stamp duty (~7% Punjab, ~6% Chandigarh) + 1% registration is NOT financeable.** An EMI-only
  calculator hides a lakh-scale cost — see `lib/home-loan.ts`.
- **WhatsApp is the dominant lead channel**, not email. Treat it as primary.

## Geography: `@tricity/geo` is the single source of truth

6 cities, **102 localities** (Chandigarh 55 sectors — **Sector 13 does not exist**; Mohali 11
phases + sectors 66-91; Kharar/Zirakpur/New Chandigarh named colonies).

Shared by the API seed *and* the website so the DB and the site can never disagree about which
sectors exist.

**⚠️ Locality slugs are unique PER CITY, not globally.** The DB enforces `UNIQUE (city_id, slug)`.
Always key on a `(citySlug, localitySlug)` pair — routes are `/localities/[city]/[locality]`, and
URL params serialise as `area=mohali/sector-70`. A bare "sector-70" is ambiguous across the
tricity's three sector-numbering municipalities, and resolving it wrong tells a buyer a property is
in a different town.

**⚠️ Locality centroids are GENERATED from a grid model and are off by ~1-2km.** Every row carries
`is_approximate = true` / `boundary_source = 'GENERATED_RADIUS'`. Replace with real OSM polygons
before launch — the Overpass query is in the header of `packages/geo/src/tricity.ts`.

**⚠️ The generated boundaries OVERLAP, so a point resolves to MORE THAN ONE locality.** Confirmed
against the live database: a point in central Chandigarh `ST_Intersects` both Sector 27 and
Sector 33. Never write locality resolution that assumes a single hit — rank by distance to
centroid and expect ties until real polygons land.

## Content strategy: sparse on purpose

Editorial copy lives in `apps/web/src/config/localities.ts`, an **overlay** keyed by
(city, locality) — separate from the geography facts.

**Only localities with hand-written content get an indexed page.** 102 templated pages would be
near-identical thin content, which reads as doorway spam and damages the domain. `generateStaticParams`
and the sitemap iterate `localitiesWithContent()` — currently 8. Target 20+ *real* guides.
Everything else is searchable and linked from the city hub, just not given a page.

**⚠️ All current editorial copy and every price band is UNVERIFIED DRAFT.** Written from general
knowledge, not researched. The agent must review it, and price bands must be replaced with real
figures, before launch.

## Phases — current status

- **Phase 1 (frontend) — COMPLETE and pivoted to India.** 28 routes build. Home, search + map with
  polygon draw, listing detail, locality hub → city hub → locality guide, seller funnel, own
  listings, about, contact, EMI/stamp-duty calculator, market reports, sitemap, robots, JSON-LD.
- **Phase 2 — search/filters/saved-search/lead scoring done.** Remaining: user accounts +
  favourites, and actually *sending* alerts (needs an email/WhatsApp provider).
- **Backend — identity slice RUNNING against real Postgres.** `apps/api` serves helmet, CORS,
  zod-validated config, a global throttler, the JWT guard, health probes, and a full identity
  module (staff email+password, consumer phone-OTP + linked email/password, rotating refresh
  tokens with reuse detection). All 12 migrations applied, seed loaded, 28/28 end-to-end checks
  passing. **No automated tests yet** — every bug so far was found by hand. That is the next job.
- **Phase 3 — NOT STARTED.** AI natural-language search, grounded concierge chatbot,
  speed-to-lead auto-WhatsApp (TODO marker in `src/app/api/leads/route.ts`), automated market emails.

## 👉 START HERE — the database is up and the backend is proven

**The long-standing blocker is GONE.** Docker runs, all 12 migrations have applied, the seed is
loaded, and the identity module has been exercised end to end against real Postgres (28/28
checks). **Do not re-diagnose the machine and do not re-verify the schema** — see Step 13 in the
build log for exactly what was run and what it found.

```
npm run db:up          # PostGIS container (postgis/postgis:16-3.4, name tricity-postgres)
npm run db:migrate     # idempotent, checksum-verified
npm run db:seed        # 6 cities, 102 localities
npm run api:dev        # http://localhost:3001/api
```

Dev staff credentials, if you need a signed-in session:
`owner@tricityestate.test` / `dev-owner-password-123`. If the volume was reset, recreate with
`npm run db:bootstrap -- --email you@example.com --name "You" --org "Firm"` — there is no staff
registration route by design, so this command is the only way the first admin exists.

**The next job is tests, ahead of any new feature.** Every bug so far was found by hand, and
nothing in the repo guards any of it. In priority order:

1. **That `FORCE ROW LEVEL SECURITY` actually bites** — one org must not be able to read
   another's listing. It already shipped as a silent no-op once and nothing caught it. Single
   most valuable test in the repo; see the RLS note below.
2. `can_view_listing()` across every tier × visibility × status.
3. Refresh-token rotation: presenting a used token must revoke the whole family.
4. `withTenant()` leaks no org across pooled connections.

Then: catalog module, then `ApiProvider` in `apps/web` to replace `MockProvider`.

## Backend rules that are easy to get catastrophically wrong

- **`ENABLE ROW LEVEL SECURITY` is not enough.** Postgres exempts the table OWNER from its own
  policies, and the API connects as the migration role. Every table under RLS also needs
  `FORCE ROW LEVEL SECURITY` — without it the policies are silent no-ops and partners can read
  each other's inventory. Fixed in `0010`; do not "simplify" it back.
- **Pre-authentication lookups go through the `SECURITY DEFINER` functions in `0011`**, never by
  disabling RLS and never by setting `is_platform_admin` (which would grant an unauthenticated
  caller admin over every table). Anything added there must pin `search_path` and return the
  minimum columns.
- **Every `SECURITY DEFINER` function MUST pin `search_path = pg_catalog, public`.** Not
  theoretical here: the postgis image sets a database-level
  `search_path = "$user", public, topology, tiger`, so a `$user` schema resolves ahead of
  everything. `can_view_listing()` shipped unpinned and was fixed in `0012`.
- **Principal-kind decorators (`@StaffOnly` / `@ContactOnly`) go on the CONTROLLER CLASS, not the
  route.** The guard only checks a kind when a route asks for one, so a route that forgets the
  decorator accepts a valid token of the *wrong* kind — `/auth/staff/me` answered a buyer's
  phone-OTP token before this was fixed. At class level, safe is the default.
- **Drizzle and raw SQL must never share a postgres.js client.** `drizzle(sql)` overwrites that
  client's json and date/time codecs *in place*, globally, so raw queries then fail to serialise
  a `Date` (a driver-internal `ERR_INVALID_ARG_TYPE`) and read timestamps back as strings still
  typed `Date`. They get separate clients — see the block comment in `database/client.ts`.
- **Always `withTenant()`, never raw `this.sql`, for tenant-scoped queries.** It uses
  `set_config(..., true)` — the parameterised `SET LOCAL`. A plain `SET` persists on a pooled
  connection and leaks the previous request's org to the next one.
- **`refresh_token` holds two kinds of principal** (`user_id` XOR `contact_id`, enforced by CHECK).
  Both auth services must reject a token of the wrong kind, or a consumer session could be
  upgraded to a staff one.
- **NestJS satellite packages at v12 are pure ESM** and cannot be imported from this CJS app —
  keep `@nestjs/*` on the 11 line. `@nestjs/config` and `@nestjs/passport` were removed; config is
  zod, the guard is hand-written.
- **If Nest says a package is missing that plainly exists**, check where npm hoisted it — a stale
  lockfile nested `platform-express` under `apps/api` while `core` was at the root, and the error
  message blamed the wrong thing.

## Gotchas worth knowing before you edit

- **Workspace packages import extensionless** (`./area`, not `./area.js`). They ship raw TS and are
  compiled by consumers; Turbopack will not map a `.js` specifier back to the `.ts` source and the
  build fails with "Can't resolve ./area.js".
- **`packages/*` must NOT set `"type": "module"`** — `apps/api` (NestJS 11) is CommonJS and TS
  errors TS1479 on a CJS→ESM static import.
- **`apps/api/tsconfig.json` needs `rootDir: "../../"`** so cross-package source is allowed.
- **`apps/web` needs `transpilePackages`** in `next.config.ts` plus explicit `paths` — its tsconfig
  does **not** extend `tsconfig.base.json`.
- **Tailwind v4** generates utilities from `@theme` tokens: `bg-status-active`, `rounded-card` —
  NOT v3-style `bg-[--color-status-active]`.
- **maplibre-gl v6 has no default export.** Named imports only (`MapLibreMap`, `Marker`,
  `NavigationControl`, `LngLatBounds`); a default import fails the Turbopack build.
- **MapLibre can't be server-rendered** — loads via `MapPanel.tsx` doing `dynamic(..., {ssr:false})`.
- **Large TSX files fail through bash heredocs** here — use the Write tool.
- **Counting elements in HTML?** Everything appears ~2x because Next embeds the RSC flight payload
  beside the SSR markup. **Divide by two.** Also: `$` appears constantly in that payload, so a naive
  `$` search will look like USD prices when there are none.
- **The result count on `/search` is client-rendered** (inside Suspense) so it is absent from SSR
  HTML — count cards or read pagination instead.
- `apps/web/AGENTS.md` + `CLAUDE.md` are **auto-generated by `next dev`**; committing them keeps the
  tree clean.

## Conventions

- Server Components by default; client components only for map + interactive filters.
- Listing/locality pages must be server-rendered and crawlable (SEO is a core feature).
- Never hardcode localities or agent details — they live in `@tricity/geo` and `config/site.ts`.
- Nx module boundaries in `.eslintrc.boundaries.json` are the Spring Modulith substitute.
- Target LCP < 2.5s.

**Explicitly out of scope:** own AVM/Zestimate clone (liability; a valuation *form* routing to a
real consultation converts better anyway), rental/tenant portals, transaction management, e-signature.

## Open questions for the user

1. **Agent's real details** — name, firm, RERA registration numbers (per jurisdiction), photo,
   phone/WhatsApp/email. Everything is placeholder.
2. **Real price bands and editorial review** for the 8 locality guides.
3. **WSL install** — the only thing blocking all backend work.
