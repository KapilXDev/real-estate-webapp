# Architecture

> Status: **proposed, awaiting approval.** Nothing here is implemented yet.
> Decisions recorded here are agreed with the user unless marked OPEN.

## Context

Real estate platform for the **Chandigarh / Mohali / Kharar** tricity market.

The defining constraint: **India has no MLS.** There is no IDX, no RESO feed, no cooperative
listing database. Inventory sourcing is therefore a first-class engineering problem, not a
licensing formality — which is why `catalog`, `partners`, and `ingestion` are the architectural
centre of gravity rather than an afterthought.

## Agreed decisions

| Decision | Value | Notes |
|---|---|---|
| Backend | **NestJS + TypeScript** | Reversed from an earlier Spring Boot proposal — see ADR-001 |
| Frontend | Next.js App Router (existing) | Phase 1 UI is reusable |
| Database | **PostgreSQL + PostGIS** | PostGIS does polygon search properly |
| ORM | **Drizzle** | SQL-first; Prisma's PostGIS support is too weak |
| Architecture | **Hybrid** — modular core + 3 extracted services | |
| Auth | **Native JWT** (Spring Security / Keycloak rejected) | Access + rotating refresh |
| Partner model | **Partner accounts, they post their own** | Forces real multi-tenancy in v1 |
| Deployment | **Local Docker Compose for now** | K8s/Terraform deferred |
| Team | 2–4 developers | Contract-first so work parallelises |
| Event bus | Redpanda (Kafka API) | Lighter ops than Kafka; same API |

## ADR-001: NestJS over Spring Boot

**Reversed** after the deployment and team answers landed.

Spring Boot was proposed first on the strength of Spring Security and Spring Modulith. Three
constraints overturned it:

1. **Local Docker Compose with 6+ containers.** JVM services idle at ~400MB–1GB each versus
   ~100–200MB for Node. Across core + 3 services + infra, that is the difference between a
   workable dev laptop and constant swapping.
2. **The frontend is already TypeScript.** One language enables a shared `contracts` package
   consumed by both sides — no OpenAPI codegen step, no client/server drift, and any dev on a
   2–4 person team can work either end.
3. **The requested layering (DTO/DAO/repo/service/controller) is NestJS's default shape.**
   Spring is more flexible, which here means the discipline must be imposed rather than inherited.

**Accepted losses and mitigations:**
- Spring Security maturity → native JWT was chosen anyway; `@nestjs/jwt` + Passport + guards.
- Spring Modulith build-time boundary enforcement → **Nx tags** enforce boundaries at lint time.
- Runtime type safety → TS types erase; validate hard at every boundary (`class-validator`, `zod`).
- **PostGIS support is the one genuine regression.** Mitigated by choosing Drizzle (SQL-first)
  over Prisma, keeping spatial predicates in explicit SQL inside the repository layer.

## Service topology

```
┌──────────────────────────────────────────────────────────────┐
│  apps/web  —  Next.js (SSR/SSG, SEO-critical)                │
└───────────────────────────┬──────────────────────────────────┘
                            │ REST (+ shared contracts package)
┌───────────────────────────▼──────────────────────────────────┐
│  apps/api  —  NestJS modular core                            │
│                                                              │
│   identity   organizations, users, RBAC, JWT, refresh        │
│   geography  cities, localities (sectors/phases), polygons   │
│   catalog    properties, listings, media refs, moderation    │
│   projects   builder/developer inventory (RERA projects)     │
│   partners   partner orgs, invitations, approval workflow    │
│   search     PostGIS + full-text query engine                │
│   leads      capture, scoring, assignment, saved searches    │
└───────┬──────────────────────────────┬───────────────────────┘
        │ Redpanda (Kafka API)         │ PostgreSQL + PostGIS
        │                              │
┌───────▼────────┐ ┌─────────────────┐ ┌──────────────────────┐
│ media-service  │ │ notification-svc │ │ ingestion-service    │
│ upload, resize │ │ WhatsApp, SMS,   │ │ builder feeds,       │
│ watermark, EXIF│ │ email fan-out    │ │ partner CSV import   │
└────────────────┘ └──────────────────┘ └──────────────────────┘
```

### Why exactly these three are extracted

Not arbitrary — each has a genuinely different failure and scaling profile from the core:

- **media-service** — CPU-bound image work. Would block the API event loop and needs to scale on
  a completely different axis. Also the most likely thing to crash on a malformed upload.
- **notification-service** — talks to flaky third parties (WhatsApp Cloud API, SMS gateways).
  Needs independent retry/backoff and must never take the API down when a vendor is having a
  bad day.
- **ingestion-service** — long-running batch imports with unpredictable runtime. Isolating it
  keeps a slow builder feed from consuming API capacity.

Everything else stays in the modular core until a concrete reason to split appears. Module
boundaries are already enforced, so extraction later is mechanical rather than surgical.

## Layered structure (per module)

The requested layering, applied consistently:

```
src/modules/<module>/
├── <module>.controller.ts      HTTP only. No business logic. Maps DTO ↔ service calls.
├── dto/
│   ├── create-<x>.dto.ts       Request shapes. class-validator decorators.
│   └── <x>-response.dto.ts     Response shapes. Never leak entities to the wire.
├── <module>.service.ts         Business logic + orchestration. Owns transactions.
├── repositories/
│   └── <x>.repository.ts       ALL database access. Drizzle queries + raw SQL for PostGIS.
├── entities/
│   └── <x>.entity.ts           Drizzle schema definitions (the DAO layer).
├── mappers/
│   └── <x>.mapper.ts           Entity ↔ DTO. Keeps leakage impossible by convention.
└── <module>.module.ts          Nest module wiring.
```

**Rules the team should hold to:**
- Controllers never touch repositories. Services never build raw SQL outside a repository.
- Entities never cross the HTTP boundary — always map to a response DTO.
- Cross-module access goes through the other module's *service*, never its repository.
- Every DTO validated with `whitelist: true` and `forbidNonWhitelisted: true`.

## Repository layout (proposed — needs approval)

```
/
├── apps/
│   ├── web/                    Next.js (migrate existing Phase 1 code here)
│   ├── api/                    NestJS modular core
│   ├── media-service/
│   ├── notification-service/
│   └── ingestion-service/
├── packages/
│   ├── contracts/              Shared DTOs + zod schemas (frontend ⟷ backend)
│   ├── domain/                 Value objects: Money(INR), Area(marla/kanal/sqft), Locality
│   └── config/                 Shared tsconfig / eslint bases
├── infra/
│   └── docker/                 docker-compose.yml, service Dockerfiles
└── docs/
```

**Nx** as the monorepo tool — chosen over Turborepo specifically for **module boundary tags**,
which replace Spring Modulith's build-time enforcement.

> ⚠️ This restructure moves the existing Phase 1 Next.js app into `apps/web/`. Not yet done —
> awaiting approval.

## Security posture

Requested explicitly ("good, secure, enterprise level"). Concretely:

| Concern | Approach |
|---|---|
| Password hashing | **Argon2id** (not bcrypt) |
| Access tokens | JWT, short TTL (~15 min), asymmetric signing (RS256) |
| Refresh tokens | Rotating, stored **hashed**, with **reuse detection** → revoke family on replay |
| Authorization | Guards + `@Roles()` / `@RequirePermission()` decorators |
| Tenant isolation | `organization_id` scoping **plus Postgres RLS** as defence in depth |
| Input validation | Global `ValidationPipe`, whitelist + forbidNonWhitelisted |
| Rate limiting | `@nestjs/throttler`, tighter limits on auth and lead endpoints |
| Headers / CORS | Helmet, explicit origin allowlist |
| Audit | `audit_log` table — actor, action, entity, before/after, IP |
| Secrets | env vars locally → Vault / External Secrets when K8s lands |
| Dependencies | `npm audit` + OWASP dependency check in CI |
| Logging | Structured JSON, **PII redacted** (phone/email never logged raw) |

RLS matters more than usual here: partner brokers post their own inventory, so a query-scoping
bug is a cross-tenant data leak between competing businesses.

## Event topics (Redpanda)

| Topic | Producer | Consumers |
|---|---|---|
| `listing.published` | catalog | search index, notification (saved-search match), media |
| `listing.updated` / `listing.withdrawn` | catalog | search index, notification |
| `lead.created` | leads | notification (WhatsApp to agent), scoring, analytics |
| `media.upload_requested` | catalog | media-service |
| `media.processed` | media-service | catalog |
| `property.viewed` | web/api | analytics, behavioural scoring |

Saved-search matching is the fan-out that justifies a real broker: one publish can match
thousands of saved searches, and that must not run inline with the HTTP request.

## Deferred (explicitly not v1)

- Kubernetes, Terraform, service mesh — local Compose only for now
- Commission / co-broking split tracking (partner network v1 stops at posting + moderation)
- Billing, subscriptions, per-tenant subdomains
- OpenSearch — Postgres FTS + PostGIS first; add when faceting demands it
- AI natural-language search, concierge chatbot
- **Redis / caching — user will signal when to add**

## Open questions

1. Do consumers (buyers) get accounts, or are saved searches email-only? Affects `contact` vs `user`.
2. Partner listing visibility — can partners see each other's inventory, or only their own + public?
3. WhatsApp Business API: Meta Cloud API directly, or via a BSP (Gupshup / AiSensy / Interakt)?
4. Languages — English only, or Hindi/Punjabi too? Affects schema (translatable columns) early.

---

## ADR-002: Nx monorepo + hybrid runtime split (fault isolation)

**Context.** The user asked for production-grade behaviour where "if one module is not working
the whole shall not fail", framing this as a reason to choose microservices.

**Key correction.** Source-code organisation (monorepo vs polyrepo) and runtime fault isolation
are **orthogonal**. A monorepo can contain many independently deployed, independently failing
services — this is how Google, Uber and Meta operate. Repo layout does not create runtime coupling.

**Decision.** Nx monorepo for code; hybrid runtime split for deployment; explicit resilience
patterns for fault isolation.

**Why not full microservices.** In Node, a bug in a request handler throws and returns 500 for
*that request only* — the process survives. Process-level isolation therefore protects against a
specific, narrow set of failures: OOM, event-loop blocking, and resource exhaustion. The three
extracted services are precisely the components that exhibit those failure modes (CPU-bound image
work, flaky third-party I/O, unbounded batch runtime). Splitting `identity` from `catalog` would
buy almost nothing while introducing distributed transactions and eventual consistency across a
tightly-coupled boundary.

**Extraction must stay cheap.** Every core module is a separate Nx library with its own schema
and no cross-module DB access. Extracting one later is a deployment configuration change, not a
refactor.

### Resilience patterns (these are what actually deliver the requirement)

| Pattern | Protects against | Implementation |
|---|---|---|
| Separate containers (media/notif/ingest) | OOM, event-loop block, CPU starvation | Compose → K8s |
| Async via Redpanda | Consumer down → events queue and drain on recovery | Kafka consumer groups |
| Circuit breaker | Dead dependency cascading into pool exhaustion | `opossum` |
| Timeout + retry w/ jittered backoff | Slow dependency becoming a site-wide outage | Interceptors |
| Bulkhead — pool per dependency | One slow consumer eating the whole pool | Separate pg pools |
| Graceful degradation | Partial outage becoming total | Media down → placeholder images; search index down → Postgres fallback |
| **Transactional outbox** | Lost events / dual-write inconsistency | `outbox` table + relay poller |
| N replicas + health probes | Single crash being user-visible | `/health`, `/ready` |

**The outbox is not optional.** Writing to Postgres and publishing to Redpanda in the same logical
operation cannot be atomic without it. Every state change writes an `outbox` row inside the same
transaction as the domain write; a relay publishes and marks rows sent. This is the difference
between "usually consistent" and "correct".

## ADR-003: Consumer identity linking

**Decision.** Consumers get multiple credentials on a single identity — phone+OTP and
email+password on day one, social providers later — modelled as `contact` (the person) plus
`contact_identity` (how they authenticate).

**Rationale.** Requested explicitly ("like we login to fb insta and stuff"). Modelling credentials
as rows rather than columns means adding Google/Facebook later is zero schema change. Retrofitting
this after launch means migrating live credentials, which is high-risk.

**Account linking rule.** If a new identity presents a **verified** email or phone already
attached to an existing contact, link it. Otherwise create a new contact and prompt the user to
link manually. Never auto-link on an unverified claim — that is an account-takeover vector.

## Confirmed: language scope

**English only** for v1. Editorial columns are still shaped so translations can be added as a
sibling table without rewriting queries. No translatable columns in migration 0001.
