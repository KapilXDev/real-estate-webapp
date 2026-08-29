# Build Log

**Purpose:** running state of the build, updated after every step so a lost session can resume
without re-exploring. Newest entry at the top.

**Resuming?** Read `CLAUDE.md` first (plan + decisions), then the top entry here (current state).

---

## NEXT UP

Buyer-side is the priority (user set 70/30 buyer/seller), so in order:
1. `/listings/[listingKey]` — full property detail page (gallery, specs, mortgage calc, tour CTA).
2. `/search` — server-rendered filter + results grid, shareable/crawlable URLs.
3. Map view with polygon draw (MapLibre, client component) layered onto `/search`.
4. `/neighborhoods` index + `/neighborhoods/[slug]` pages w/ live listings, stats, FAQ schema.
5. `/home-value` seller valuation funnel (highest-converting page on the site).
6. `/about`, `/contact`, lead-capture API + storage.
7. `sitemap.ts`, `robots.ts`, JSON-LD structured data.

## OPEN QUESTIONS (blocking real content, not blocking code)

- Market area + neighborhoods the realtor works — needed to replace placeholder neighborhood pages.
  User said they'd provide it; not yet received. Everything is config-driven so this is a
  one-file change when it arrives.
- IDX/MLS feed status — user has not asked their broker yet.
- Agent name, brokerage, license #, headshot, phone/email.

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
