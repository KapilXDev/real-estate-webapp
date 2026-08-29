# Setup

> **Resuming in a new session? Start here, then `CLAUDE.md`, then `docs/BUILD_LOG.md`.**

## Current blocker (as of 2026-08-29)

**Docker is not installed, because WSL is not installed.**

Docker Desktop on Windows requires WSL2. `wsl --status` reports:

```
The Windows Subsystem for Linux is not installed.
You can install by running 'wsl.exe --install'.
```

That is the "requirement issue" the Docker Desktop installer reported.

**Machine state verified:**

| Check | Result |
|---|---|
| Windows | 11 Pro, 10.0.26200 — supported |
| `HypervisorPresent` | True ✅ |
| `VirtualizationFirmwareEnabled` | True ✅ (BIOS virtualization is on) |
| `wsl.exe` present | Yes, but WSL itself is not installed |
| Docker binary / service / Desktop | None ❌ |
| `winget` | Available ✅ |
| Shell elevation | **Not elevated** ❌ |

Virtualization is already enabled, so no BIOS changes are needed. Only the WSL install and a
reboot stand in the way.

---

## Fix: install WSL2 + Docker Desktop

**Both steps need an Administrator terminal, and step 1 needs a reboot. Neither can be done from
a non-elevated agent shell.**

### 1. Install WSL2 — run in an **Administrator** PowerShell

```powershell
wsl --install
```

Then **reboot**. After rebooting, confirm:

```powershell
wsl --status
wsl --version
```

### 2. Install Docker Desktop

```powershell
winget install --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
```

Launch Docker Desktop once so it finishes first-run setup, then verify:

```powershell
docker --version
docker compose version
docker info
```

### 3. Bring up the database and apply the schema

From the repo root:

```bash
npm run db:up        # starts PostGIS on localhost:5432
npm run db:migrate   # applies migrations 0001-0010
npm run db:seed      # 6 cities, 102 localities
```

Expected seed output ends with:

```
Seeded geography:
  Chandigarh          55 localities (55 approximate)
  Kharar               5 localities (5 approximate)
  Mohali              37 localities (37 approximate)
  New Chandigarh       2 localities (2 approximate)
  Zirakpur             3 localities (3 approximate)
```

---

## Alternative if you want to avoid WSL entirely

Native PostgreSQL, no Docker. **Not recommended** — see the trade-off below.

```powershell
winget install --id PostgreSQL.PostgreSQL.17
```

PostGIS is **not** in winget. It installs via EDB StackBuilder (bundled with the PostgreSQL
installer: *Application Stack Builder → Spatial Extensions → PostGIS*), or from
<https://postgis.net/windows_downloads/>.

Then point `DATABASE_URL` in `.env` at the native instance.

**Why this is the worse option:** Testcontainers needs Docker. Without it the RLS integration
tests cannot run — and `can_view_listing()` is the function that, if wrong, leaks inventory
between competing brokerages. That is precisely the code that must not ship untested. Native
Postgres unblocks migrations and day-to-day development, but leaves the highest-risk code path
unverifiable.

---

## First run, once Docker works

```bash
npm install              # if node_modules is missing
npm run db:up
npm run db:migrate
npm run db:seed
npm test                 # 19 geography tests, no DB required
npm run web:dev          # Next.js on :3000
```

## Environment

Copy `.env.example` to `.env`. For local development the defaults work as-is, except the JWT
keypair:

```bash
openssl genrsa -out jwt-private.pem 2048
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem
# base64 both into JWT_PRIVATE_KEY_BASE64 / JWT_PUBLIC_KEY_BASE64
```

Leave `NEXT_PUBLIC_SITE_URL` unset until launch — the site serves `Disallow: /` without it, which
prevents incomplete data being indexed.
