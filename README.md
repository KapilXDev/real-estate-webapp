# Tricity Estate

A property platform for the **Chandigarh / Mohali / Kharar tricity market**. Buyer-facing search
and lead capture on the front, a multi-tenant NestJS API behind it, and an admin app the agent
actually runs the business from.

> **There is no MLS in India.** No IDX, no RESO, no cooperative listing database. Inventory comes
> from the agent's own listings, builder project inventory, and a partner broker network — which
> is why this is a platform with an admin app rather than a skin over a feed.

## Layout

```
apps/
  web      Next.js  :3000  public site — search, listings, locality guides, lead capture
  admin    Next.js  :3002  staff tool — inventory, photos, enquiries, RERA
  api      NestJS   :3001  catalog, identity, leads, media
packages/
  geo        6 cities, 102 localities — the single source of truth for both DB seed and site
  domain     INR lakh/crore, marla/kanal, stamp duty — India-specific correctness
  contracts  the wire format shared between the apps
  config     shared Tailwind theme
infra/docker Postgres + PostGIS, MinIO
```

## Running it

Needs Docker and Node 20+.

```bash
npm install
cp .env.example .env          # defaults work as-is for local dev

npm run db:up                 # Postgres + PostGIS, MinIO
npm run db:migrate            # 19 migrations
npm run db:app-role           # least-privilege runtime role — see below, this is not optional
npm run db:seed               # 6 cities, 102 localities

# create the first staff account (there is deliberately no signup route)
npm run db:bootstrap -- --email you@example.com --name "Your Name" --org "Your Firm"

npm run api:dev               # :3001
npm run web:dev               # :3000
npm run admin:dev             # :3002
```

```bash
npm test --workspace=@tricity/api    # 170 integration tests, ~2s
npm run test:e2e                     # 26 browser tests, ~22s — needs all three servers running
```

⚠️ **`apps/web` and `apps/admin` each need their own `.env.local`.** Next only reads `.env` files
from its own app directory — it does not walk up to the monorepo root, whereas `apps/api`
deliberately does. Copy the web/admin blocks out of `.env.example`. The failure mode is
confusing if you skip it: the dev server starts fine and *then* every page 500s, because the
config is read at render rather than at boot.

Integration tests run against a template database cloned per suite — no Testcontainers, no extra
dependency.

The browser tests in `e2e/` are the opposite by design: they drive Chromium against the real dev
stack, because what they check — a photo actually decoding, a cookie actually being resent, a
publish actually reaching the public site — only exists once the three processes are wired
together. They clean up after themselves by matching an `[E2E]` marker, the same way
`db:demo` matches `[SAMPLE]`. See the header of `e2e/playwright.config.ts`.

## Things that will bite you

**Two database roles, and they are not interchangeable.** `DATABASE_URL` is the owner (migrations,
DDL). `APP_DATABASE_URL` is what serves requests. A superuser — which `POSTGRES_USER` is in the
Docker image — **ignores row-level security entirely**, so pointing the API at the owner silently
disables every tenant-isolation policy. The API refuses to boot if it detects this.

**RERA is three separate regulators inside 20 km.** Punjab RERA covers Mohali, Kharar, Zirakpur
and New Chandigarh; Chandigarh is a Union Territory with its own authority; Panchkula is Haryana's.
A registration with one does not cover the others, a website counts as advertising, and the
penalty runs to ₹10 lakh. Publication is blocked at the API for any jurisdiction you are not
registered in — drafts are always allowed.

**Money is lakh/crore, not thousands.** `formatPriceShort` is the default display, not a fallback,
and `parsePriceInput` accepts "85 lakh" and "1.25cr" because that is what agents type. Misreading
it is a 10⁵ error.

**Area is marla/kanal, and the conversion factor is stored per row.** Punjab marla is 272.25 sq ft
but the unit is regionally ambiguous, so historical listings rehydrate with the factor they were
written with.

**Locality slugs are unique per city, not globally.** Three tricity municipalities number their
sectors, so always key on a `(citySlug, localitySlug)` pair.

More in `CLAUDE.md` (architecture and decisions) and `docs/`:

- `docs/FLOWS.md` — buyer, seller and agent journeys end to end, and what is still missing
- `docs/BUILD_LOG.md` — what was built, in what order, and why; newest entry first
- `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/SETUP.md`

## Status

Working: public search and listing pages, lead capture into Postgres, staff auth, listing CRUD,
photo upload with WebP derivatives, the enquiry queue, RERA management, and tenant isolation
enforced by row-level security and covered by tests.

Not done before this can face the public: real agent details and RERA numbers (a launch guard
refuses to serve a public site until they are filled in), verified price bands for the locality
guides, real OSM locality polygons in place of the generated circles, and speed-to-lead
auto-WhatsApp.
