# Build Log

**Purpose:** running state of the build, updated after every step so a lost session can resume
without re-exploring. Newest entry at the top.

**Resuming?** Read `CLAUDE.md` first (plan + decisions), then the top entry here (current state).

---

## NEXT UP

1. **User installs WSL** (admin shell + reboot) → `npm run db:up && npm run db:migrate && npm run db:seed`.
   Expect and fix first-run SQL errors; **11** migrations have still never executed.
2. Testcontainers integration tests, in priority order:
   - `can_view_listing()` — every tier × visibility × status combination.
   - **That `FORCE ROW LEVEL SECURITY` actually bites** (see Step 12) — a test that one org cannot
     read another's listing is the single most valuable test in this repo.
   - Refresh-token rotation and reuse detection: presenting a used token must revoke the family.
3. Catalog module, then `ApiProvider` in `apps/web` to replace `MockProvider`.

## OPEN QUESTIONS (blocking real content, not blocking code)

- **Agent's real details** — name, firm, RERA registration per jurisdiction, headshot,
  phone/WhatsApp/email. All placeholder in `apps/web/src/config/site.ts`.
- **Real price bands + editorial review** for the 8 locality guides in
  `apps/web/src/config/localities.ts`. Current copy is unverified draft.
- Which additional localities deserve hand-written guides (target 20+).

---

## 2026-08-29 — Step 12: Identity module + two schema bugs found before they shipped

**`apps/api` went from 6 plumbing files to a running NestJS application.** It boots, serves
health checks, enforces auth and validation, and rate-limits — all verified against a live process.

## 🔴 TWO SCHEMA BUGS FOUND WHILE IMPLEMENTING AGAINST THE SQL

Both were in migrations that had never run, so both were fixed at source rather than patched.

### 1. RLS was a complete no-op (`0010_rls.sql`)

The file used `ENABLE ROW LEVEL SECURITY` only. **Postgres exempts a table's OWNER from its own
policies**, and the API connects as the same role that runs the migrations. Every policy in that
file — the entire cross-tenant protection, the thing the whole multi-tenant design exists for —
would have silently done nothing. No error, no warning, and partner brokerages able to read each
other's inventory.

Fixed by adding `FORCE ROW LEVEL SECURITY` to all four tables.

That immediately created a chicken-and-egg problem: login must read `app_user` before it knows the
org, but the policy needs `current_org_id()`. The tempting fixes are all wrong — dropping RLS on
`app_user` reopens the hole, and setting `is_platform_admin` at login grants an *unauthenticated*
caller admin over every table. So **`0011_auth_lookup.sql`** adds three narrow `SECURITY DEFINER`
functions (`auth_lookup_staff`, `auth_lookup_refresh_token`, `auth_revoke_token_family`) — a
deliberate keyhole, not an open door. All pin `search_path` (unpinned is the classic SECURITY
DEFINER privilege escalation) and return only login-relevant columns.

### 2. `refresh_token` could not store consumer sessions (`0003_identity.sql`)

`user_id` had `REFERENCES app_user(id)`, but the agreed auth model gives **contacts** sessions too,
and a contact is not an `app_user`. Every buyer login would have failed on a foreign key violation
the first time it ran.

Fixed with two nullable FKs (`user_id`, `contact_id`) plus a CHECK enforcing that **exactly one**
is set, so "both" and "neither" are unrepresentable. Chose that over a polymorphic id with no FK
because losing referential integrity means deleting a principal silently orphans live sessions.
`auth_lookup_refresh_token` LEFT JOINs accordingly and returns `principal_kind` so callers never
infer it from which column is null. Both auth services reject a token of the wrong kind — a
consumer token presented to the staff refresh endpoint cannot be upgraded, and vice versa.

## Written this step

- **`main.ts`** — helmet, CORS, `trust proxy` (without it every client looks like the proxy and
  per-IP limits collapse into one shared bucket), global ValidationPipe with
  `forbidNonWhitelisted`.
- **`config/configuration.ts`** — zod-validated env. **No default JWT secret, deliberately**: a
  fallback would mean every deployment that forgot to set one shares a signing key. `JWT_ACCESS_TTL`
  is regex-checked because jsonwebtoken treats a bare numeric string differently from a number and
  a typo like "15mins" fails unpredictably.
- **`database/database.service.ts`** — `withTenant()` runs work in a transaction with
  `set_config(..., true)` (the parameterised `SET LOCAL`). **`SET LOCAL`, never `SET`**: postgres.js
  pools connections, so a plain `SET` would leak the previous request's org id to whoever borrows
  that connection next. `withoutTenantForAuth()` is named to be conspicuous in review.
- **`identity/`** — `PasswordService` (Argon2id, OWASP params, plus `fakeVerify` so the
  unknown-email path burns comparable time and does not become an account-enumeration oracle),
  `TokenService` (opaque random refresh tokens — SHA-256 not Argon2, since 256 bits of CSPRNG
  output has no dictionary to attack — with family rotation and reuse detection),
  `OtpService`, `StaffAuthService`, `ContactAuthService`, DTOs, `JwtAuthGuard`, module.
- **`health/`** — separate liveness and readiness. Liveness deliberately does NOT touch the
  database: wiring a DB check to liveness turns a brief DB blip into a restart storm.
- **Drizzle schema** in `database/schema/` — mirrors the SQL, does not generate it.

**Consumer auth is the linked-identity model the user asked for:** one `contact` row is the person,
each `contact_identity` row is a way of proving it. Phone OTP creates the account on first verify;
email+password can be linked afterwards to the *already-proven* identity. Adding Google later is a
data change, not a schema change.

**OTP hardening** — SMS-pumping fraud is a direct financial loss, not just abuse, so: per-destination
cooldown, 3/min per IP on the request endpoint, prior challenges consumed on resend (otherwise ten
resends give ten simultaneous guesses), attempts incremented *before* comparison (so disconnecting
mid-verify still costs an attempt), constant-time hash comparison.

## ⚠️ DEPENDENCY PROBLEMS FOUND — the previous step's install was not what it claimed

- **`@nestjs/throttler` was in `apps/api/package.json` but NEVER ACTUALLY INSTALLED.** Step 9
  recorded pinning the whole stack to NestJS 11 *because of* throttler's peer cap — but the package
  itself was absent from `node_modules`. Now installed at 6.5.0.
- **`@nestjs/jwt@12`, `@nestjs/config@12` and `@nestjs/passport@12` are pure ESM** (`"type":
  "module"`) while `@nestjs/common`/`core` are CommonJS 11. TS1479 on import. Downgraded jwt to
  11.0.2; **removed `@nestjs/config`, `@nestjs/passport`, `passport`, `passport-jwt`** entirely —
  config is zod and the guard is hand-written, so they were unused surface.
- **A stale `package-lock.json` was nesting `@nestjs/platform-express` under `apps/api`** while
  `@nestjs/core` sat at the root, so Nest's loader could not resolve the HTTP driver and the app
  refused to start with a misleading "please install @nestjs/platform-express". Regenerating the
  lockfile fixed it. Worth remembering: if Nest claims a package is missing that is plainly
  present, check *where* it is hoisted.

## Verified against a running process, not just a typecheck

- `nest build` ✓, `tsc --noEmit` clean on `apps/api` and `apps/web`, 58 tests still pass, `next build` ✓
- **API boots** → `GET /api/health/live` → `{"status":"ok"}`
- Guard: no token → 401 "Missing bearer token"; garbage token → 401 "Invalid or expired token"
- Validation: bad email, short password, and **`isAdmin` rejected as "property isAdmin should not
  exist"** — `forbidNonWhitelisted` doing exactly the job it is there for
- Phone normalisation: `"12345"` → 400; **`"9876543210"` → normalised to `+919876543210`** and
  reached the database layer (500, because Postgres is down — the expected failure)
- **Throttling fires** — repeated OTP requests return 429
- **Config fails fast**: unset secrets abort startup with a per-field list, rather than booting

## STILL UNVERIFIED — everything that touches the database

11 migrations have never executed. The SQL is unrun, the SECURITY DEFINER functions have never
been called, and no query in the identity module has ever reached a real Postgres. Expect
first-run errors; that is normal, not a sign of a bad design.

**Known rough edge:** a database outage currently surfaces as a bare 500. It should be a 503 with
a retry hint. Left as-is deliberately rather than guessing at the shape before any real connection
error has ever been observed.

---

## 2026-08-29 — Step 11: apps/web pivoted to India; @tricity/geo extracted

**The website was still the US realtor site.** It rendered Washington Park / Downtown / West Side,
USD prices, MLS attribution and Equal Housing. All of it is gone. 44 files touched, ~135 type
errors worked through.

## New shared package: `@tricity/geo`

Geography moved out of `apps/api/src/database/seed/geography.ts` into `packages/geo`, imported by
**both** the API seed and the website — so the DB and the site can never disagree about which
sectors exist. Added lookup helpers (`getCity`, `getLocality`, `localitiesInCity`, `localityLabel`,
`tricityBounds`) and `localityKey`.

⚠️ **Locality slugs are unique per city, not globally.** Encoded that everywhere:
- Routes are now `/localities/[city]/[locality]`, with a new `/localities/[city]` hub tier.
- `ListingQuery` carries `LocalityRef[]`, URLs serialise `area=mohali/sector-70`.
- `Listing` carries `citySlug` + `localitySlug`, never a bare slug.

**Tests: 24 in geo** (19 moved + 5 new for the helpers, incl. one asserting
`getLocality("chandigarh","sector-70")` is undefined while Mohali's exists).

## `@tricity/domain` had ZERO tests — now 34

These are the highest-blast-radius functions in the repo and were entirely unguarded. Added
`money.spec.ts` + `area.spec.ts` pinning: the crore boundary, Indian digit grouping, Punjab
marla = 272.25 / kanal = 5,445, `fromStored` preserving a legacy factor, and — the important one —
that `parsePriceInput("85")` is ₹85, **not** ₹85 lakh. A silent 10⁵ promotion there would misprice
a listing in a way that looks entirely plausible on the page.

Also `formatPriceShort` ⟷ `parsePriceInput` round-trip, since one renders what the other reads back.

## Listing model: RESO vocabulary deleted

It implied a feed integration that will never exist. `mlsNumber` → `referenceCode` (prefixed `TE-`
so it doesn't read as an industry identifier), `listOfficeName` → `listedByFirm`, `associationFee`
→ `maintenanceCharges`, `lotSizeSquareFeet` → `plotArea`. US escrow statuses ("Pending", "Active
Under Contract") → "Under Offer" (bayana taken).

**Added, because they're what this market actually filters on:** `possession`
(ready-to-move/under-construction/new-launch), `furnishing`, `facing`, `carpetArea` vs
`builtUpArea` vs `plotArea` as separate `StoredArea` values, `reraAgentRegistration` (required, not
optional) and `reraProjectRegistration`, `priceOnRequest`.

Property types are now plot / kothi / builder-floor / flat / villa / SCO / SCF / booth / farmhouse.

## Compliance: RERA replaces MLS/NAR

Same structural defence, different law. `ListingAttribution` renders unconditionally on every card;
`SiteFooter` carries **all three jurisdictions** (PbRERA, Chandigarh, HRERA Panchkula) because a
Punjab registration does not cover the UT. `site.compliance.mlsDisclaimer`/`mlsCopyright`/
`equalHousing` deleted; `reraForState()` resolves per listing from `@tricity/geo`'s `state`.

## Mortgage → home loan, and the reason it matters

`lib/mortgage.ts` → `lib/home-loan.ts`. Dropped PMI (doesn't exist here) and escrowed insurance
(not standard). **Added stamp duty + registration + processing fee as an upfront-cash panel** —
~8% in Punjab, **not financeable**, and the single most expensive thing an EMI-only calculator
hides. Also models the lower female-buyer stamp duty rate, which is a real ~₹2 lakh saving on a
₹1 crore purchase. Rates are marked verify-annually; they move in state budgets.

## Content strategy — deliberately sparse

`config/neighborhoods.ts` deleted; `config/localities.ts` is now an **editorial overlay** keyed by
(city, locality), separate from geography facts. **Only the 8 localities with hand-written content
get an indexed page** — 102 templated pages would be thin/doorway content and would damage the
domain. `generateStaticParams` and the sitemap iterate `localitiesWithContent()`.

⚠️ **All 8 guides and every price band are unverified draft copy.** Flagged loudly in-file.

## Monorepo wiring fixed (three real traps)

1. **Removed `"type": "module"`** from `packages/domain` and `packages/geo` — `apps/api` is CJS
   (NestJS 11) and TS errors **TS1479** on a CJS→ESM static import.
2. **`apps/api` `rootDir: "../../"`** — cross-package source otherwise violates rootDir (TS6059).
3. **Internal imports must be extensionless** (`./area`, not `./area.js`). TS resolves the `.js`
   form; **Turbopack does not** and the build dies with "Can't resolve ./area.js". Cost a full
   build cycle to find.
   `apps/web` also needed `transpilePackages` + its own `paths` (its tsconfig does not extend
   `tsconfig.base.json`).

## Verified against a running dev server, not just a build

- `next build` ✓ **28 routes**; 5 city hubs + 8 locality guides SSG'd with 1h revalidate
- **58 tests pass** (24 geo + 34 domain); `tsc --noEmit` clean on both `apps/web` and `apps/api`
- All 15 routes HTTP 200
- **0 USD-shaped prices**, 0 "Washington Park", 0 "MLS", 0 "Equal Housing" anywhere in the HTML
- Filters: `city=mohali`, `area=mohali/sector-70` (19), `type=plot`, `possession=new-launch` (10),
  `maxPrice=5000000` (3), impossible filter → empty state ✓
- **Polygon draw still correct** — box over Mohali Sector 70 returns 19 Sector 70 + 2 adjacent
  Sector 74 listings, and `poly + city=chandigarh` returns **0**. That last one is the real proof
  the polygon is genuinely geographic.
- `robots.txt` still `Disallow: /` on sample data ✓ (safety mechanism intact)
- `sitemap.xml`: 122 URLs = 9 static + 5 city + 8 locality + 100 listings; no stale routes ✓
- Listing detail: `SingleFamilyResidence`, `priceCurrency: INR`, `addressCountry: IN`, marla areas,
  EMI + stamp duty panel, WhatsApp CTA ✓
- `POST /api/leads` → 201, scoring intact (85 for both tour-request and home-valuation)

**Bug found and fixed during verification:** the generator produced **"1 BHK Kothi"** — a kothi is a
whole independent house and starts around 3 bedrooms. Bedroom ranges are now per property type
(kothi 3-6, flat 1-4, villa 3-5, builder floor 2-4). Verified after the fix.

## Also fixed
- `apps/api` `test` script → `--passWithNoTests` (the geography spec moved to `packages/geo`, so
  `nx run-many -t test` would otherwise fail on an empty workspace).
- Root `CLAUDE.md` **rewritten** — it still described the US/IDX world and is the first thing a
  fresh session reads, so it was actively misleading.

## STATE OF THE BACKEND — unchanged, still blocked
10 migrations and the seed remain **authored but NEVER EXECUTED**. `apps/api` still has no
`main.ts` and no modules. WSL is still not installed, so Docker's engine cannot start.

---

## 2026-08-29 — Step 10: BLOCKED — Docker missing because WSL is not installed

**User reported Docker Desktop showed "a requirement issue" and asked me to install the
prerequisite. Root cause diagnosed; the install itself needs elevation + reboot, so it is on
the user.**

## Root cause
**WSL is not installed.** Docker Desktop on Windows requires WSL2.
`wsl --status` → *"The Windows Subsystem for Linux is not installed. You can install by running
'wsl.exe --install'."* That is the requirement error the installer showed.

## Machine state (verified this step — do NOT re-diagnose)
| Check | Result |
|---|---|
| Windows | 11 Pro 10.0.26200 — supported |
| `HypervisorPresent` | **True** ✅ |
| `VirtualizationFirmwareEnabled` | **True** ✅ — BIOS virtualization already on, no BIOS trip needed |
| `wsl.exe` binary | present at C:\WINDOWS\system32\wsl.exe, but WSL not installed |
| Docker binary / service / Desktop.exe | **none** — nothing was actually installed |
| `winget` | available ✅ |
| Agent shell elevation | **NOT elevated** ❌ |
| `Get-WindowsOptionalFeature` | fails — needs admin |

## What blocks me specifically
`wsl --install` requires an Administrator shell **and a reboot**. `winget install Docker.DockerDesktop`
requires admin. The agent shell is non-elevated and non-interactive, so a UAC prompt cannot be
completed from here. This is a genuine hand-off, not a skipped step.

## Package research done (don't redo)
- winget HAS: `PostgreSQL.PostgreSQL.17` (17.11-1), `PostgreSQL.PostgreSQL.18` (18.6-1)
- winget does **NOT** have PostGIS. PostGIS installs via EDB StackBuilder
  (*Application Stack Builder → Spatial Extensions → PostGIS*) or postgis.net/windows_downloads/
- Docker Desktop package id: `Docker.DockerDesktop`

## Written this step
- **`docs/SETUP.md`** — full prerequisite guide, exact commands, expected seed output, and the
  native-Postgres fallback with its trade-off spelled out.

## Recovery commands (for the user, in an ADMIN PowerShell)
```
wsl --install                 # then REBOOT
winget install --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
# launch Docker Desktop once, then:
npm run db:up && npm run db:migrate && npm run db:seed
```

## Fallback considered and NOT recommended
Native PostgreSQL + PostGIS (no Docker) would unblock migrations/seed today, but **Testcontainers
needs Docker** — so the RLS integration tests could not run. `can_view_listing()` is the function
that leaks inventory between competing brokerages if wrong; shipping it untested is the one
trade-off not worth making. Documented in SETUP.md as an option, with that caveat.

## STATE OF THE CODE — unchanged from Step 9, still true
- 10 migrations **authored but NEVER EXECUTED**. Treat all SQL as unverified until it hits a real
  Postgres. Expect to fix syntax errors on first run — that is normal, not a sign of a bad design.
- Seed authored, never applied.
- 19 geography tests **do pass** (`npx vitest run --root apps/api`) — they need no DB.
- `apps/web` builds (18 routes) but still renders the OLD US placeholder neighborhoods; not yet
  wired to the API.

## NEXT UP once Docker runs
1. `npm run db:up && npm run db:migrate && npm run db:seed` — expect and fix first-run SQL errors.
2. Verify PostGIS: `SELECT PostGIS_Version();` and confirm 102 localities with GiST indexes used
   (`EXPLAIN` a `ST_Intersects` query).
3. Identity module vertical slice: entities → repository → service → controller → DTOs.
4. Testcontainers integration tests for RLS — every tier x visibility x status combination of
   `can_view_listing()`.

---

## 2026-08-29 — Step 9: Dependencies installed, migrations + geography seed written

**Done:**

**Installs (user approved).** NestJS **11** stack, Drizzle, argon2, testcontainers, vitest, nx.
- ⚠️ **Pinned to NestJS 11 deliberately, not 12.** `@nestjs/throttler@6.5.0` peer-caps at
  `^11.0.0`, which is why npm silently backtracked `@nestjs/common` to 11.2.3 and then failed
  ERESOLVE on `@nestjs/testing@12`. Rate limiting is a stated security requirement, so keeping
  throttler beat chasing 12. Revisit when throttler ships v12 support.
- Ran `npm approve-scripts` for argon2/esbuild/nx/unrs-resolver/protobufjs/cpu-features/ssh2 —
  argon2 needs node-gyp and silently no-ops otherwise. Verified: hash produces `$argon2id$` ✓
- **Held back as agreed:** Redis/cache, kafkajs.

**TypeScript 6.0.3 is installed** — `moduleResolution: node10` and `baseUrl` are both deprecated
and error out. Moved the workspace to `module/moduleResolution: node16` and dropped `baseUrl`
(TS 5+ resolves `paths` relative to the tsconfig). `apps/api` needs explicit
`types: ["node"]` + `typeRoots` because @types/node at the workspace root isn't auto-discovered.

**10 SQL migrations** in `apps/api/src/database/migrations/`.
**Decision: hand-written SQL, NOT drizzle-kit generate.** The schema needs PostGIS geography
columns, a generated tsvector, CHECK constraints, SECURITY DEFINER functions and RLS policies —
Drizzle's generator models none of these well, and fighting a generator into emitting correct
security policy SQL is a bad trade when a wrong policy is a cross-tenant leak. Drizzle still
provides query typing; it just doesn't own DDL.

Notable schema choices worth not re-deriving:
- `0003` refresh tokens use `family_id` + reuse detection — replaying a used token revokes the
  whole family (OAuth 2.1 guidance).
- `0005` CHECK constraints: carpet area <= built-up area, floor <= total floors, ACTIVE listings
  must have `published_at`. Catching nonsense at write time, not in search results.
- `0005` `search_vector` is a GENERATED column, not a trigger — cannot drift.
- `0010` `SET LOCAL` (not `SET`) for `app.current_org_id`: with a shared pool a plain SET leaks
  across tenants. `can_view_listing()` is SECURITY DEFINER + STABLE.
- `0009` audit_log has **no FKs on purpose** — an audit trail must survive deletion of the actor
  it describes.
- `property`/`locality`/`city`/`project` are deliberately NOT under RLS: they describe shared
  physical reality, and duplicate detection must see across orgs to work at all.

**Migration runner** (`migrate.ts`): per-file SHA-256 checksums (editing an applied migration is
a hard error, not a silent no-op), pg advisory lock against concurrent migrators, each file in
its own transaction. Line endings normalised so Windows checkouts agree with Linux CI.

**Geography seed** — 6 cities, **102 localities**: Chandigarh 55 sectors (13 correctly omitted —
Le Corbusier left it out), Mohali 11 phases + 26 sectors (66-91; both naming systems needed,
buyers use each), Kharar 5 named colonies, Zirakpur 3, New Chandigarh 2.
- ⚠️ **City centroids are real. Locality centroids are GENERATED from a grid model and are off
  by roughly 1-2km** (e.g. generated Sector 17 = 30.7596,76.7683 vs actual ~30.7410,76.7822).
  Every row written with `is_approximate = true`, `boundary_source = 'GENERATED_RADIUS'`, so the
  replacement job finds them with one WHERE clause. **Overpass query for the real OSM polygons is
  in the header of `seed/geography.ts`.** Must be replaced before launch — draw-search accuracy
  depends on it.
- Seed is idempotent and will NOT overwrite a boundary once `is_approximate = false`, nor
  clobber hand-written editorial copy.

**19 tests passing** (`geography.spec.ts`) — bounding box, slug uniqueness, Sector 13 absence,
grid spread, adjacent-sector spacing, and **GeoJSON [lng,lat] ordering** (swapping those is the
classic PostGIS bug and silently relocates everything to the Indian Ocean).

**Verified:** `tsc --noEmit` clean on apps/api; `vitest run` 19/19; `next build` succeeds from
`apps/web` after the move (18 routes).

**Committed:** `f2315d7`.

## BLOCKER
**Docker is not installed on this machine** (`docker: command not found`, not on PATH, no service).
Nothing DB-backed can be executed or verified: migrations have never been run, the seed has never
been applied, and Testcontainers integration tests cannot run. All SQL above is **authored but
unexecuted** — treat it as unverified until a Postgres exists.

## NEXT UP
1. User installs Docker Desktop → `npm run db:up && npm run db:migrate && npm run db:seed`.
2. Then the identity module as the first vertical slice: entities → repository → service →
   controller → DTOs, with Testcontainers integration tests exercising the RLS policies
   (especially every tier x visibility x status combination of `can_view_listing`).
3. `apps/web` still renders the OLD US placeholder neighborhoods (washington-park etc.) from
   `src/config/neighborhoods.ts`. It is not yet wired to the API — that happens after the
   identity + catalog slices land.

---

## 2026-08-29 — Step 8: Nx monorepo restructure + domain package

**Answers locked this step:**
| Question | Answer |
|---|---|
| Repo | **Nx monorepo** — see ADR-002. User asked for fault isolation; corrected the premise that monorepo implies monolith. |
| Buyer auth | **Both** phone+OTP AND email+password on a linked identity model ("like fb/insta") — ADR-003 |
| Partner visibility | **Tiered, per partner** — `partner_relationship` + `can_view_listing()` policy fn |
| Languages | **English only** v1; columns shaped so a translation sibling table is addable |

**Key correction made to the user (worth not re-litigating):** monorepo vs polyrepo is
*source organisation*; fault isolation comes from deployment topology + resilience patterns.
They are orthogonal axes. Fault isolation is delivered by: separate containers for the 3 extracted
services, async via Redpanda, circuit breakers (`opossum`), timeouts + jittered backoff, bulkhead
connection pools, graceful degradation, **transactional outbox**, and N replicas + health probes.
See the resilience table in ARCHITECTURE.md ADR-002.

**Done:**
- Restructured to Nx monorepo. `git mv` used so Phase 1 history is preserved.
  - `apps/web/` — the Next.js app, renamed `@tricity/web`
  - `packages/domain/` — `@tricity/domain`
  - `packages/contracts/` — `@tricity/contracts` (wire format, must stay dependency-free)
  - `packages/config/`, `infra/docker/`
- Root `package.json` (npm workspaces), `tsconfig.base.json` with `@tricity/*` path aliases,
  `nx.json`, `.gitignore`, `.env.example`.
- `.eslintrc.boundaries.json` — Nx `@nx/enforce-module-boundaries` depConstraints.
  **This is the Spring Modulith replacement.** Merge into root ESLint config once Nx is installed.
- **`packages/domain/src/area.ts`** — `Area` value object. Punjab marla = 272.25 sq ft,
  kanal = 5,445 sq ft. Stores inputValue + inputUnit + canonical sqft + **the conversion factor
  used**, and `fromStored()` rehydrates using the STORED factor so historical rows never shift
  if the constant is later corrected. Bigha flagged as state-variable/approximate.
- **`packages/domain/src/money.ts`** — INR lakh/crore. `formatPriceShort` (₹1.25 Cr) is the
  DEFAULT display, not a fallback. `parsePriceInput()` accepts "85 lakh"/"1.25cr"/"₹85,00,000"
  because agents type that far more often than 8500000 — misreading it by 10^5 would be severe.
  Price buckets are market-shaped (dense ₹30L–₹1.5Cr), not evenly spaced.
- `infra/docker/docker-compose.yml` — **PostGIS only**, healthchecked. MinIO and Redpanda are
  written but commented out; enable when media upload / first event fan-out land.
- Killed the Phase 1 dev server (it held file locks and blocked the `git mv`).

**Committed:** `3cfe0cf`.

## NEXT UP — BLOCKED ON USER APPROVAL TO INSTALL
User said: *"keep me posted on what you do i will tell you when to install that."*
**Nothing has been npm-installed. `node_modules` was deleted during the restructure — the repo
does not currently build.** Awaiting go-ahead on:
- Base: `nx`, `@nestjs/*`, `drizzle-orm`, `drizzle-kit`, `postgres`, `@nestjs/jwt`,
  `@nestjs/passport`, `passport-jwt`, `argon2`, `class-validator`, `class-transformer`, `zod`,
  `helmet`, `@nestjs/throttler`, `vitest`, `testcontainers`, `supertest`
- **Explicitly held back:** Redis/cache (user will signal), `kafkajs` (until first fan-out exists)

Then: migrations 0001-0008, seed tricity geography (Chandigarh Sectors 1-56, Mohali Phases 1-11 +
Sectors 66-91, Kharar belt), then the identity module as the first vertical slice.

---

## 2026-08-29 — Step 7: PIVOT — India market, NestJS backend, design phase

**MAJOR PIVOT. Read this before touching anything from Steps 1-6.**

**What changed:**
- Market confirmed as **Chandigarh / Mohali / Kharar (India)**. **There is no MLS in India** —
  no IDX, no RESO, no cooperative listing database. The entire US data-sourcing premise of
  Phase 1 is void. **RERA replaces NAR/IDX** as the compliance regime (registration number must
  appear on the website; up to ₹10 lakh penalty; Punjab RERA for Mohali/Kharar, separate
  Chandigarh authority — the agent spans TWO jurisdictions).
- User is a **software developer**, not a non-technical realtor. Earlier memory corrected.
  They want architecture-level discussion and **approval gates before implementation**.
- Scope is now a **professional multi-service web app**, not a static agent site.

**Decisions locked this step:**
| | |
|---|---|
| Backend | **NestJS + TypeScript** (reversed from Spring Boot — see ADR-001 in ARCHITECTURE.md) |
| DB | PostgreSQL + **PostGIS**, **Drizzle** ORM (Prisma rejected: weak PostGIS) |
| Architecture | Hybrid — modular core + media/notification/ingestion extracted |
| Auth | Native JWT, Argon2id, rotating refresh w/ reuse detection |
| Partners | **Partner accounts, they post their own** → real multi-tenancy + RLS required in v1 |
| Deploy | **Local Docker Compose only** for now; K8s/Terraform deferred |
| Team | 2-4 devs |
| Monorepo | Nx (chosen over Turborepo for **module boundary tags** = Spring Modulith substitute) |

**Why NestJS won over Spring Boot** (the deployment + team answers flipped it):
local Compose with 6+ containers makes JVM memory (~400MB-1GB/service vs ~150MB Node) a real
constraint on dev laptops; the frontend is already TS so a shared `contracts` package removes
client/server drift; and NestJS's default shape *is* the requested DTO/DAO/repo/service/controller
layering. Accepted loss: PostGIS support in TS ORMs is weaker — mitigated by choosing Drizzle
(SQL-first) and keeping spatial predicates in explicit SQL in the repository layer.

**Written this step (design only — NO code, NO installs):**
- `docs/ARCHITECTURE.md` — ADR-001, service topology + why exactly those 3 are extracted,
  per-module layering rules, repo layout, security posture, event topics, deferred list.
- `docs/DATA_MODEL.md` — full schema design. Three shaping decisions:
  1. **`property` separate from `listing`** — partner brokers listing the same kothi must not
     produce duplicate search results.
  2. **Area stored twice** (`area_sqft` canonical + `area_input_value`/`area_input_unit`) because
     marla/kanal/gaj don't divide cleanly into sq ft. Punjab marla = 272.25 sq ft, kanal = 5,445
     sq ft — but marla is regionally ambiguous, so the conversion factor is stored per row.
  3. **Money as `numeric(16,2)` INR**, lakh/crore formatting at the edge only.
  Plus RLS policies (partners are competing businesses in one DB), audit log, migration order.

**Status of Phase 1 code:** frontend/design system/components/geo math/lead scoring are reusable.
The `ListingProvider`/RESO/IDX abstraction and US compliance layer are **dead** (~30%).

## NEXT UP (awaiting user approval — do not start unilaterally)
1. Approve/amend the repo restructure into Nx monorepo (`apps/web` move is destructive-ish).
2. Approve the dependency list (user explicitly said: **tell them before installing anything**,
   they will signal when to add cache/Redis).
3. Answer the 3 open questions (buyer logins vs phone-OTP; partner cross-visibility; languages).
4. Then: migrations 0001-0009, seed tricity geography, identity module first vertical slice.

---

## 2026-08-29 — Step 6: Phase 1 complete — all pages, SEO, seller funnel

**PHASE 1 IS COMPLETE AND LAUNCHABLE** (pending real content + IDX feed).

**Done:**
- `src/app/neighborhoods/page.tsx` — city-level hub linking every guide, with live inventory
  counts per area. Layered SEO structure: hub -> neighborhood guides.
- `src/app/neighborhoods/[slug]/page.tsx` — **the highest-leverage SEO asset.** Market snapshot,
  lifestyle copy, highlights, FAQ block, live listings, saved-search capture.
  `generateStaticParams` + `revalidate = 3600`. Emits **Place + FAQPage JSON-LD** — the FAQ
  schema is a real ranking surface for local queries, not decoration.
- `src/components/leads/HomeValuationForm.tsx` — **two-step, address first.** That ordering is
  the whole trick: entering an address feels like using a tool, so by the time the contact step
  appears the visitor has already invested effort. Deliberately gives NO instant automated
  number (a wrong AVM destroys credibility with exactly the sellers worth winning).
- `src/app/home-value/page.tsx` — seller landing page. Single-purpose by design: no listing grid,
  no cross-links, nothing competing with the form.
- `src/app/listings/page.tsx` — own listings + **sold history** (the credibility proof sellers
  actually look for).
- `src/components/leads/ContactForm.tsx` + `src/app/contact/page.tsx` — phone/email shown as
  tappable links ABOVE the form; intent selector for routing/prioritisation.
- `src/app/about/page.tsx` — bio, stats, testimonials, areas served + `RealEstateAgent` JSON-LD.
  **All copy is placeholder** — testimonials MUST be replaced before launch (fabricated ones are
  a trust and licensing problem).
- `src/app/mortgage-calculator/page.tsx` — standalone SEO page, seeded from local median price.
- `src/app/market-reports/page.tsx` — per-neighborhood comparison table from live stats,
  revalidated hourly. Doubles as the monthly-email hook.
- `src/app/sitemap.ts` — priorities weighted to what actually ranks (neighborhood guides 0.95).
  Sold listings excluded to save crawl budget.
- `src/app/robots.ts` — **disallows everything while `NEXT_PUBLIC_SITE_URL` is unset**, so a
  sample-data build cannot be indexed as though it were real MLS inventory.

**Verified against the running dev server:**
- All 15 routes return 200 ✓
- `robots.txt` correctly returns `Disallow: /` on sample data ✓ (safety mechanism works)
- `sitemap.xml` contains 65 URLs ✓
- `FAQPage` JSON-LD present on neighborhood pages ✓
- Market report stats render from live inventory ✓
- Valuation lead scored **85** (phone + address + "1-3 months" timeframe) ✓
- 2 leads persisted to `.data/leads.jsonl` ✓
- Build output: 18 routes, 3 SSG neighborhood pages w/ 1h revalidate ✓

## Phase 2 status (partially done ahead of schedule)
Already built: IDX-ready search, map + polygon draw, saved-search capture, filters.
Still to do: user accounts + favorites, actually SENDING listing alerts (needs an email provider).

## Phase 3 (not started)
AI natural-language search, grounded concierge chatbot, speed-to-lead auto-SMS
(TODO marker is in `src/app/api/leads/route.ts`), automated market-report emails.

---

## 2026-08-29 — Step 5: Search, filters, and map with polygon draw

**Done:**
- `src/lib/listings/query-params.ts` — bidirectional URL <-> `ListingQuery` mapping.
  **The URL is the source of truth for all search state** (shareable, crawlable, back-button
  correct, works without JS). Polygons compact-encode as `"lat lng lat lng|..."` rounded to
  5dp. Also `activeFilterCount()` and `describeQuery()`.
- `src/components/search/ListingMap.tsx` — MapLibre map with **draw-your-own-area**. Click to
  place vertices, double-click/Enter to close, Escape to cancel. Drawn rings go into the URL and
  **append** (multiple areas union). Price-pill markers, fitBounds on results (suppressed while
  drawing so the map doesn't yank). OSM raster tiles — no API key needed.
  NOTE: maplibre-gl v6 ESM has **no default export** — use named imports
  (`MapLibreMap`, `Marker`, `NavigationControl`, `LngLatBounds`, types `GeoJSONSource`,
  `MapMouseEvent`, `StyleSpecification`). A default import fails the Turbopack build.
- `src/components/search/MapPanel.tsx` — thin client wrapper doing `dynamic(..., {ssr:false})`.
  Needed because MapLibre touches `window` at module scope and `ssr:false` is only allowed
  inside a client component. Also keeps MapLibre out of the bundle for non-map visitors.
- `src/components/search/SearchFilters.tsx` — price/beds/baths/sqft/year/**max HOA**, property
  type, neighborhood, and must-have feature chips. Every change writes to the URL. Filter set is
  deliberately limited — a wall of checkboxes reduces how many people filter at all.
- `src/components/leads/SavedSearchPrompt.tsx` — **email-only** capture (every extra field costs
  signups; the criteria are already known from their filters). The best recurring-touchpoint
  play against the portals.
- `src/app/search/page.tsx` — server-rendered results, list/map split view, pagination,
  empty state with a "tell me what you're looking for" conversion path. Map view fetches up to
  300 results (a map showing 24 of 300 homes is misleading), list view paginates at 24.

**Verified against a running dev server (not just a build):**
- `/`, `/search`, `/search?view=map`, `/listings/[key]`, `/api/placeholder/...` all HTTP 200
- Unfiltered search: 53 active listings, 24 cards on page 1
- Filtered (`minPrice=250000&beds=3&area=washington-park`): 12 cards
- **Polygon search**: hand-built box over Washington Park narrows 53 → 13 cards ✓
- Impossible filter (`minPrice=9000000`) renders the empty state ✓
- Attribution present on every card ✓
- `POST /api/leads` → `{"ok":true,...,"score":95}` — tour request with phone + date scored "hot",
  matching the intended weighting ✓

**Note:** when counting elements in curl output, HTML appears ~2x because Next embeds the RSC
flight payload alongside the SSR markup. Divide by 2.

---

## 2026-08-29 — Step 4: Listing detail page + lead capture

**Done:**
- `src/lib/mortgage.ts` — amortization + **total** monthly cost (P&I, tax, insurance, HOA, PMI).
  Rationale: P&I-only calculators understate the real number by 25-40% and send buyers to tour
  homes they can't afford. Handles the 0% rate case (divide-by-zero in the standard formula).
  TODO: `DEFAULT_INTEREST_RATE` is static — wire to a live rate source (e.g. FRED MORTGAGE30US).
- `src/components/listings/MortgageCalculator.tsx` — client component, prefilled from the
  listing's real tax + HOA figures, with a component breakdown and an estimate-not-a-quote notice.
- `src/components/listings/PhotoGallery.tsx` — hero + thumbnail mosaic, lightbox with keyboard
  nav (arrows/Escape) and background scroll lock.
- `src/components/leads/TourRequestForm.tsx` — the primary conversion point. **4 fields max**
  by design; phone optional but nudged (enables fast text-back); message prefilled with the
  address so a hesitant buyer can submit in one click. Posts listing context with the lead.
- `src/app/listings/[listingKey]/page.tsx` — full detail page: breadcrumb, gallery, specs,
  description, features, property facts, neighborhood context block, mortgage calculator,
  **sticky** tour CTA sidebar, nearby listings, and schema.org `SingleFamilyResidence` JSON-LD.
- `src/lib/leads/types.ts` — `Lead` carries behavioural + attribution context, not just contact
  details, so follow-up can be specific rather than generic.
- `src/lib/leads/scoring.ts` — 0-100 priority score. **Weights are a hypothesis, not fitted to
  real data** — revisit once there are closed deals to check against.
- `src/lib/leads/store.ts` — `LeadStore` interface + append-only JSONL `FileLeadStore`.
  Same swap pattern as ListingProvider; later target is a real CRM (Follow Up Boss / Sierra).
  Append-only because a lost lead is lost revenue. Tolerates a truncated final line.
- `src/app/api/leads/route.ts` — intake endpoint. Validation is deliberately forgiving except
  on name/email; length-capped against abuse. Contains the **speed-to-lead TODO** (auto-SMS
  within 60-90s) — deliberately not fake-stubbed, needs a real SMS provider + opt-in language.
- `.gitignore` — `.data/` excluded (leads are personal data).

**Verified:** `npm run build` passes. Routes: `/`, `/listings/[listingKey]`, `/api/leads`,
`/api/placeholder/...`.

**Note:** large TSX files fail via bash heredoc in this environment — use the Write tool for
those; heredocs are fine for smaller `.ts` files and shell scripts.

---

## 2026-08-29 — Step 3: Design system, layout, home page

**Done:**
- `src/app/globals.css` — Tailwind v4 `@theme` design tokens. Palette is warm editorial
  (forest green `brand-*`, warm neutral `sand-*`, terracotta `clay-*` accent) plus per-status
  listing colors. **Rationale:** the portals all use saturated tech-blue; warm editorial reads as
  deliberately not-Zillow and lets property photography lead. Also: reduced-motion support and
  visible focus rings.
  NOTE: Tailwind v4 generates utilities from `@theme` tokens — use `bg-status-active` and
  `rounded-card`, NOT v3-style `bg-[--color-status-active]`.
- `src/lib/format.ts` — price/sqft/baths/lot/days-on-market/relative-time formatting.
- `src/lib/cn.ts` — className joiner (no clsx dependency needed).
- `src/app/api/placeholder/[seed]/[w]/[h]/route.ts` — deterministic SVG property placeholders
  generated in-process. No external image service, works offline, retired when real photos land.
- `src/components/listings/StatusBadge.tsx` — status pill, consistent colors sitewide.
- `src/components/listings/ListingAttribution.tsx` — **the compliance component.** Renders
  "Courtesy of {brokerage}". Suppresses real MLS disclaimer while `isLiveMlsData` is false.
- `src/components/listings/ListingCard.tsx` — shared card. Renders attribution
  **unconditionally by design** — a card cannot exist without it. Do not add a prop to hide it.
  Uses a stretched link so the whole card is clickable but only one link is in the a11y tree.
- `src/components/layout/SiteHeader.tsx` — nav w/ mobile menu, click-to-call, and the
  "What's My Home Worth?" CTA styled as primary (highest-converting page on the site).
- `src/components/layout/SiteFooter.tsx` — nav + **compliance block** (Equal Housing mark,
  license numbers, MLS disclaimer, copyright). Do not remove to tidy the design.
- `src/app/layout.tsx` — Inter + Fraunces fonts, metadata w/ title template, skip link.
  `robots` set to noindex unless `NEXT_PUBLIC_SITE_URL` is set, so sample-data builds can't
  be indexed.
- `src/app/page.tsx` — home page: hero search (plain GET form, works without JS), just-listed
  grid, neighborhood grid, seller valuation CTA, agent intro.
- `next.config.ts` — `dangerouslyAllowSVG` for the first-party placeholder route, with CSP
  sandbox. Has a commented `remotePatterns` slot for the future MLS photo CDN.

**Verified:** `npm run build` succeeds. 4 static pages + placeholder route. TypeScript clean.

---

## 2026-08-29 — Step 2: Config layer + listing data architecture

**Done:**
- `src/config/site.ts` — agent, brokerage, market, and MLS compliance strings. All placeholder.
  Nothing in the app hardcodes agent details; one edit here updates the whole site.
- `src/config/neighborhoods.ts` — the SEO backbone. 3 placeholder neighborhoods with intro,
  lifestyle copy, highlights, FAQs, coordinates, price bands, housing types.
  **Key design:** this one file drives the landing pages, the map framing, AND sample listing
  generation — so swapping in the realtor's real market relocates the entire site.
- `src/lib/listings/types.ts` — `Listing` modelled on RESO Data Dictionary field names
  (listPrice, bedroomsTotal, standardStatus...) so the future IDX mapping is ~1:1.
  Also `ListingQuery` (all filters incl. polygons + bounds) and `ListingResult`.
- `src/lib/listings/provider.ts` — the `ListingProvider` interface. The seam that makes the
  IDX gate a non-blocker. Note `isLiveMlsData` flag: gates real MLS attribution so we never
  show a board's copyright line over fabricated data.
- `src/lib/listings/geo.ts` — ray-casting point-in-polygon, bounds tests, haversine distance,
  bounds fitting. Powers draw-your-own-area search. Multiple polygons = UNION (matches how
  buyers think, and mirrors Zillow multi-area search).
- `src/lib/listings/mock-provider.ts` — seeded/deterministic sample listings derived from the
  neighborhood config, plus the full query engine (filter, sort, paginate). The query engine is
  **not throwaway** — it defines the exact semantics `ResoProvider` must reproduce.
- `src/lib/listings/index.ts` — `getListingProvider()` factory. `MLS_PROVIDER=reso` throws
  loudly rather than silently falling back to sample data (silent fallback on a live site would
  be a compliance problem, not just a bug).

**Verified:** `npx tsc --noEmit` passes clean.

**Architecture note for future sessions:** never import `MockProvider` directly in a component.
Always go through `getListingProvider()`. That indirection is the entire IDX migration plan.

---

## 2026-08-29 — Step 1: Scaffold + continuity setup

**Done:**
- Researched modern real estate agent site features (IDX/MLS mechanics, lead conversion benchmarks,
  hyperlocal SEO, AI features, compliance). Findings distilled into `CLAUDE.md`.
- Agreed scope with user: full phased build, 70/30 buyer/seller weighting.
- Scaffolded Next.js: App Router, TypeScript, Tailwind, ESLint, `src/` dir, `@/*` alias, npm.
  Git repo initialized by create-next-app.
- Wrote `CLAUDE.md` (architecture + decisions, auto-loads in a fresh session).
- Wrote persistent memory files for cross-session continuity.

**State:** clean Next.js scaffold, no custom code yet.

**Verified:** `node v24.18.0`, `npm 11.16.0`, 358 packages installed, 0 vulnerabilities.
