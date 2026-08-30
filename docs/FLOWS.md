# Flows — who does what, and what the system does back

End-to-end journeys through the platform. Read alongside `ARCHITECTURE.md` (how it is built) and
`DATA_MODEL.md` (what is stored).

**Status key:** ✅ built · 🚧 partial · ❌ not built

---

## 1. Buyer — the primary journey

The buyer is ~70% of the product. Everything below works today against real inventory when
`LISTING_PROVIDER=api`.

### 1.1 Arrival

A buyer lands from one of three places, and they behave very differently:

| Entry | Intent | Where they land |
|---|---|---|
| Google: *"3 bhk flat mohali sector 70"* | High — they named a locality | Locality guide, or `/search` pre-filtered |
| Google: *"property in chandigarh"* | Low — browsing | City hub `/localities/chandigarh` |
| Direct / referral | Mixed | Home page |

**Why locality pages matter so much:** the high-intent query names a sector, and only a page that
is actually about that sector ranks for it. That is why editorial content is deliberately sparse —
102 templated pages would be near-identical thin content and would read as doorway spam.

✅ Home, city hubs, 8 locality guides, `/search`, sitemap, JSON-LD.

### 1.2 Search and refine

```
Buyer sets filters
   ↓
apps/web  ListingQuery  →  toSearchParams()  →  GET /api/catalog/listings?...
   ↓
apps/api  SearchListingsDto (validate + clamp)  →  CatalogService  →  ListingRepository
   ↓
Postgres  RLS: can_view_listing(...) as an ANONYMOUS caller
   ↓                  ↑ only PUBLIC + ACTIVE/UNDER_OFFER survive
ListingDto[]  →  ApiProvider  →  Listing[]  →  Server-rendered cards
```

The filters that actually get used here, in rough order: **possession** (ready-to-move vs
under-construction), **price band**, **BHK**, **locality**, then everything else. Possession leads
because it changes financing and risk, and buyers self-select on it before anything else.

✅ Text, city, locality, price, beds, baths, area, type, possession, furnishing, maintenance,
features, map bounds, drawn polygons, 5 sort orders, pagination.

**Draw-your-own-area** is the differentiator: "this side of the highway only" is an intent no
dropdown can express. Multiple polygons are a UNION, matching how people actually think.

### 1.3 The listing page

Everything on it is aimed at one decision: *is this worth a phone call?*

- Photos, specs, description, features
- **Carpet area leads where present** — the RERA basis for under-construction sale, precisely
  because "super area" was routinely inflated
- Area echoed in the unit the seller typed ("10 marla"), never silently converted
- Price as **₹1.45 Cr**, not ₹14,500,000 — lakh/crore is the default reading, not a fallback
- **EMI + stamp duty** together. Stamp duty (~7% Punjab, ~6% Chandigarh) plus 1% registration is
  **not financeable** — an EMI-only calculator hides a lakh-scale cash requirement
- RERA registration for *that listing's* jurisdiction
- Sticky enquiry CTA

✅ All of the above.

### 1.4 Enquiry — the revenue event

```
TourRequestForm (4 fields, phone nudged hard)
   ↓
POST /api/leads   (apps/web route handler)
   ↓
ApiLeadStore  →  POST /api/leads  (apps/api)
   ↓
LeadService:  route to owning org  →  find-or-create contact  →  score 0-100
   ↓
Postgres: lead + contact rows                        ✅ durable before the 201
   ↓
🚧 speed-to-lead auto-WhatsApp — needs a provider
```

**Routing:** a lead about a partner's listing belongs to *that partner*. Everything else goes to
the host organisation. Misfiling it is taking someone else's customer.

**Phone is weighted higher than any property attribute** in scoring, because WhatsApp is the
dominant channel here — a lead with a number can be answered in ninety seconds; one with only an
email often cannot be answered at all.

### 1.5 After the enquiry

| Step | Status |
|---|---|
| Lead stored, scored, queued | ✅ |
| Agent sees it in `GET /api/staff/leads` | ✅ (API only — no admin UI) |
| Auto-WhatsApp within 60-90s | ❌ needs WhatsApp Business API |
| Buyer account + saved favourites | ❌ (phone-OTP auth exists ✅, nothing uses it) |
| Saved-search alert emails | ❌ needs an email provider + a scheduler |

---

## 2. Seller — the highest-value journey

Fewer visitors, far more revenue each: a seller lead is a *listing*, and a listing is inventory.

```
"What's my home worth?" (primary nav CTA)
   ↓
Valuation form: address, type, area, timeframe, contact
   ↓
POST /api/leads  kind=HOME_VALUATION
   ↓
Lead scored 35 base + phone/context bonuses  →  agent's queue
   ↓
Human consultation, not an automated number
```

**No automated valuation, on purpose.** An AVM/Zestimate clone is liability without a data moat,
and a valuation *form* that routes to a real conversation converts better anyway. The number is
the agent's job.

✅ Funnel and intake. ❌ No seller portal, no listing-performance dashboard.

---

## 3. Agent / staff — inventory and follow-up

```
POST /api/auth/staff/login          ✅  email + password, argon2id, rotating refresh
   ↓
POST /api/staff/listings            ✅  create (org from the token, never the body)
   ↓
  ⚠️ RERA PUBLICATION GATE          ✅  blocks ACTIVE without a valid registration
     for THAT listing's jurisdiction     — drafts are always allowed
   ↓
PATCH /api/staff/listings/:id       ✅  price changes recorded to history automatically
GET   /api/staff/listings           ✅  own inventory incl. drafts
GET   /api/staff/leads              ✅  queue: tour requests first, then by score

POST   /api/staff/listings/:id/media        ✅  upload a photo (multipart, resized on the way in)
GET    /api/staff/listings/:id/media        ✅  incl. PENDING/FAILED rows and why they failed
PUT    /api/staff/listings/:id/media/order  ✅  reorder — the first entry is the hero image
DELETE /api/staff/listings/:id/media/:id    ✅
```

**Everything is tenant-scoped by RLS**, not by remembering a `WHERE` clause. A partner brokerage
cannot read another's inventory, leads or photos — enforced by the database and covered by 158
tests.

❌ **There is no admin UI.** All of the above is API-only, exercised with curl or a REST client.
Photo upload included. **This is now the only thing standing between the backend and a usable
product** — a separate `apps/admin` Next app is planned and approved.

---

## 4. Partner broker — planned, foundations built

The inventory strategy: the agent's own listings + builder inventory + a partner network. Partner
tiers already exist and are fully tested.

| Tier | Sees |
|---|---|
| `OWN_ONLY` | Only their own |
| `PUBLIC_PLUS_OWN` | Public catalog + their own |
| `NETWORK` | Above + network-only listings that are ACTIVE |
| `FULL` | Everything the host has, any status |

✅ Schema, `can_view_listing()`, all 108 tier × visibility × status combinations tested.
❌ No partner onboarding, no invitation flow, no moderation UI.

---

## 5. Request lifecycle (any authenticated call)

```
Request
 → helmet, CORS, trust proxy
 → ThrottlerGuard                    global backstop; tighter per-endpoint overrides
 → JwtAuthGuard                      @Public? skip. else verify + CHECK PRINCIPAL KIND
 → ValidationPipe                    DTO: whitelist, forbidNonWhitelisted, transform
 → Controller                        shape only
 → Service                           decisions
 → Repository                        withTenant(orgId) { SET LOCAL app.current_org_id; ... }
 → Postgres                          RLS policies evaluate
```

Login is the exception: it cannot know your org before it finds you, so it goes through the
`SECURITY DEFINER` functions in migration `0011` — a deliberate keyhole, not an open door.

---

## 6. What is still missing

**Blocking a real launch:**

1. ❌ **Admin UI** — inventory and leads are API-only today.
2. ✅ **Media upload — BUILT.** Multipart upload → sharp resize into thumb/card/hero WebP →
   MinIO → served through an RLS-checked proxy. EXIF rotation applied, SVG rejected, decompression
   bombs rejected, duplicates deduped by checksum.
3. ⚠️ **Real agent details + RERA numbers** — placeholders. The launch guard now refuses to serve
   a public site until they are filled in.
4. ⚠️ **Locality boundaries are generated circles**, off by 1-2 km and overlapping. Replace with
   OSM polygons; the Overpass query is in `packages/geo/src/tricity.ts`.
5. ⚠️ **Editorial copy and every price band is unverified draft.**

**Needed for the product to feel complete:**

| Service | Why | Status |
|---|---|---|
| WhatsApp Business API | Speed-to-lead; the dominant channel | ❌ |
| Transactional email | Saved-search alerts, receipts | ❌ |
| Object storage + image pipeline | Listing photos | ✅ MinIO + sharp |
| Redis | Throttler is in-memory → per-instance limits | ❌ |
| Scheduler | Alerts, market reports, expiry sweeps | ❌ |
| Error tracking | Currently `console.error` | ❌ |
| Phase 3 AI | NL search, concierge chatbot | ❌ |
