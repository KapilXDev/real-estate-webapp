# Tricity Estate — Project Context

> **Resuming in a fresh session? Read this file, then `docs/BUILD_LOG.md`, then `docs/FLOWS.md`.**
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
- **Catalog, leads, media and the ADMIN APP built.** The website serves real inventory from
  Postgres when `LISTING_PROVIDER=api`; forms write leads to Postgres; photos upload, resize to
  WebP and serve through an RLS-checked proxy; and `apps/admin` (port 3002) lets the agent do all
  of it without curl. 170 integration tests.
  Remaining before launch: real agent/RERA details, real price bands, OSM locality polygons, and
  speed-to-lead WhatsApp. See `docs/FLOWS.md`.
- **Backend — identity slice RUNNING against real Postgres.** `apps/api` serves helmet, CORS,
  zod-validated config, a global throttler, the JWT guard, health probes, and a full identity
  module (staff email+password, consumer phone-OTP + linked email/password, rotating refresh
  tokens with reuse detection). All 14 migrations applied, seed loaded, 28/28 end-to-end checks
  passing, and **132 integration tests covering tenant isolation**. Identity itself is still
  covered only by a throwaway smoke script — porting it into the harness is queued.
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
npm run db:app-role    # runtime role login — re-run after a migration that adds tables
npm run db:seed        # 6 cities, 102 localities
npm run api:dev        # http://localhost:3001/api
npm test --workspace=@tricity/api
```

Dev staff credentials, if you need a signed-in session:
`owner@tricityestate.test` / `dev-owner-password-123`. If the volume was reset, recreate with
`npm run db:bootstrap -- --email you@example.com --name "You" --org "Firm"` — there is no staff
registration route by design, so this command is the only way the first admin exists.

**Tenant isolation is now tested — 132 integration tests, ~2s** (`npm test --workspace=@tricity/api`).
They found that RLS was still completely switched off, for a second and different reason than the
one fixed in step 12; read the two-roles note under "Backend rules" before touching any connection
string. Tests run against a template database cloned per suite — no Testcontainers, no new
dependency; see `apps/api/test/support/database.ts`.

Next, in order:

1. **Catalog module** — property + listing CRUD for staff, public search for the site. The RLS
   groundwork is done and tested, so this is ordinary work now.
2. **Identity tests** — the 28-check smoke pass exists only as a throwaway script. Port refresh
   rotation, reuse detection and principal-kind separation into the harness.
3. **`ApiProvider` in `apps/web`** to replace `MockProvider`.
4. **ESLint 9 flat config for `apps/api`** — there is none, so `npm run lint` skips it entirely.

## Backend rules that are easy to get catastrophically wrong

- **⚠️⚠️ THE API MUST CONNECT AS `tricity_app`, NEVER AS THE OWNER.** A superuser — or any role
  with `BYPASSRLS` — **ignores row-level security completely**. `FORCE` does not apply and no
  policy is ever consulted. The postgres Docker image makes `POSTGRES_USER` a superuser, so
  serving requests over `DATABASE_URL` turns every policy in `0010` into a silent no-op with no
  error and entirely correct-looking results. There are **two connection strings and they are not
  interchangeable**: `DATABASE_URL` (owner — migrations, seed, bootstrap, DDL only) and
  `APP_DATABASE_URL` (runtime, `tricity_app`, created by `0013`). The API refuses to boot
  otherwise — `assertRuntimeRoleCannotBypassRls()` in `database/app-role.ts`. Do not "simplify"
  the two URLs into one.
- **`ENABLE ROW LEVEL SECURITY` is not enough.** Postgres exempts the table OWNER from its own
  policies. Every table under RLS also needs `FORCE ROW LEVEL SECURITY` — without it the policies
  are silent no-ops. Fixed in `0010`; do not "simplify" it back. Note that the runtime role is not
  the owner, so behaviour alone no longer detects a missing `FORCE` — `rls.spec.ts` asserts
  `relforcerowsecurity` against `pg_class` directly for that reason.
- **A security predicate must never return NULL.** `current_org_id()` is NULL when unset, so
  `org_id = current_org_id()` is NULL and an `OR` chain over it yields NULL, not false. A `USING`
  clause treats that as false so it fails closed — but `NOT can_view_listing(...)` is then NULL
  too, and that query silently returns nothing. `coalesce(..., false)` — fixed in `0014`.
- **`CREATE OR REPLACE FUNCTION` resets the function's attributes.** `SECURITY DEFINER` and
  `SET search_path` must be restated in full every time, or replacing a function silently strips
  its hardening.
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
- **⚠️ NEVER `${JSON.stringify(x)}::jsonb`. ALWAYS `jsonb(sql, x)`** from
  `database/json-param.ts`. postgres.js JSON-encodes a *string* parameter bound to a json/jsonb
  column, so a pre-stringified value is encoded TWICE and the column holds a JSON string —
  `jsonb_typeof` returns `'string'`. Nothing errors; reads return a string where a structure is
  expected, and a defensive `Array.isArray` check turns it into a plausible empty array. It
  shipped across `listing.features`, `lead.requirement`, `lead.source` and
  `listing_media.variants`, and made the `@>` features filter match nothing while looking fine.
  Guarded by `test/jsonb-encoding.spec.ts`.
- **Declare literal routes BEFORE parameter routes.** Nest matches in declaration order, so
  `@Get(":a/:b")` above `@Get("listings/:id")` swallows the literal segment and fails as an opaque
  driver error. Bitten twice now.
- **⚠️ `apps/api` must `import type` from `@tricity/contracts` — NEVER a value import.** The app
  compiles to CommonJS, the workspace packages ship raw TypeScript, and Node cannot `require()` a
  `.ts` file. A value import passes `tsc` and then dies at boot with `ERR_MODULE_NOT_FOUND` on an
  extensionless specifier. `catalog/utils/locality-ref.ts` duplicates the one runtime helper;
  `catalog-contract.spec.ts` round-trips the real encoder through the real DTO so they cannot drift.
- **A DTO property name must match the wire query key.** The global ValidationPipe runs with
  `forbidNonWhitelisted`, so a mismatch is a 400 — not an ignored parameter. `?area=` with a
  property called `localities` made every locality search fail with "property area should not
  exist", which reads like a validator bug.
- **RERA registrations are per (organisation, jurisdiction)** — `organization_rera`, resolved by
  joining on the listing's CITY state. `ListingAdminService` blocks publication without a valid one
  for that jurisdiction; drafts are always allowed. Do not add a bypass flag.
- **⚠️ `@Throttle` REPLACES ONLY THE NAMED LIMITERS IT LISTS.** `ThrottlerModule.forRoot` declares
  two — `short` (10 per **second**) and `default` (120/min). Overriding `default` alone leaves
  `short` in force, which is how the media route ended up serving ten images and 429-ing the rest
  of the page. Any route that legitimately takes a burst must name both.
- **⚠️ A parameter used only in `$n IS NOT NULL` has NO INFERABLE TYPE** and fails the whole
  statement at PARSE time with `42P18: could not determine data type of parameter $n` — before
  touching a row, so it looks nothing like a data problem. Cast it. This made every listing
  `update()` a 500 for as long as the method existed.
- **A field-level validation error is invisible if the field is not on screen.** The admin's edit
  form omits location and area by design, so errors keyed to those fields produced a form that
  refused to save and said nothing at all. Field errors now always carry a banner too.
- **`vitest` needs `reflect-metadata` as a setup file** for any suite importing a DTO, or
  class-validator decorators fail with `Reflect.getMetadata is not a function`.
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

## Testing: two suites, deliberately opposite

- **`npm test --workspace=@tricity/api`** — 170 integration tests, ~2s. Hermetic: a template
  database cloned per suite. Asserts things about the SCHEMA (RLS, CHECKs, SECURITY DEFINER).
- **`npm run test:e2e`** — 22 Playwright tests, ~35s, against the RUNNING dev stack. Asserts things
  about the BROWSER. It exists because the four worst bugs in this repo all passed the integration
  suite: a CORP header the server never sees, `next/image` returning 400 while the page still
  renders, a stale cache tag, and a form that silently refused to save. The canonical assertion is
  `img.naturalWidth > 0`, not `response.ok`.
  - **Shares the dev database on purpose** — the wiring between the three processes is the thing
    under test. Isolation comes from an `[E2E]` marker on every row plus a teardown scoped to it,
    exactly as `db:demo` does with `[SAMPLE]`. **Never widen a DELETE in `e2e/support/db.ts`.**
  - **One worker, not three.** The throttler keys on client IP and everything on a dev machine is
    127.0.0.1. A throttled fetch inside a Server Component does not throw — `apiGet` returns null
    and the page renders empty — so contention shows up as a plausible-looking false failure.
  - Two known bugs are recorded as `test.fail()` rather than deleted. See NEXT UP in the build log.

## apps/admin — the staff tool

Separate Next app on **port 3002**, not a route inside `apps/web`: the public site stays static
and cacheable, the admin is entirely dynamic.

- **httpOnly cookie BFF.** The browser holds no JWT and never learns the API origin; every call is
  server-side through `lib/api.ts`.
- **⚠️ TOKEN REFRESH LIVES IN `proxy.ts`, NEVER IN THE API CLIENT.** Refresh tokens rotate and a
  Server Component render cannot write cookies — so refreshing during render consumes the old
  token and discards the replacement, and the next request presents a used token, which the API
  correctly treats as theft and revokes the whole family. Proxy runs before render and can write
  both the forwarded request's cookies and the response's. Single-flight, keyed on the token.
- **Next 16 renamed `middleware` to `proxy`** and the exported function must be named `proxy`.
  Cookie-name constants live in an import-free module because proxy may run where `next/headers`
  does not exist.
- **Price input goes through `parsePriceInput`** and is echoed back as "₹1.6 Cr" before saving.
  Agents type "1.6 crore"; reading that as 1.6 is a 10⁵ error on a public page.
- **Area is entered once** — value + unit + *which* area it describes — via `Area.of()`, which
  returns the conversion factor to persist per row.
- Photos use a plain `<img>` through `/api/media/...`, never `next/image`: the optimizer would
  refetch server-side without the session and break every draft listing's thumbnails.

## Conventions

- Server Components by default; client components only for map + interactive filters.
- Listing/locality pages must be server-rendered and crawlable (SEO is a core feature).
- Never hardcode localities or agent details — they live in `@tricity/geo` and `config/site.ts`.
- **Every `apps/api` module is layered** — `controllers/` (HTTP shape only) `services/`
  (decisions) `repositories/` (**the only place SQL is written**; every method goes through
  `withTenant()`) `mappers/` (row→wire, pure) `dao/` (row shapes) `dto/` (edge validation)
  `utils/`. `catalog/` and `leads/` are the reference. The point is that the tenant rule is
  greppable: SQL outside `repositories/` is wrong. `identity/` has the directories but not yet a
  `repositories/` layer — extracting it is queued.
- Nx module boundaries in `.eslintrc.boundaries.json` are the Spring Modulith substitute.
- Target LCP < 2.5s.

**Explicitly out of scope:** own AVM/Zestimate clone (liability; a valuation *form* routing to a
real consultation converts better anyway), rental/tenant portals, transaction management, e-signature.

## Open questions for the user

1. **Agent's real details** — name, firm, RERA registration numbers (per jurisdiction), photo,
   phone/WhatsApp/email. Everything is placeholder.
2. **Real price bands and editorial review** for the 8 locality guides.
3. **WSL install** — the only thing blocking all backend work.
