# Build Log

**Purpose:** running state of the build, updated after every step so a lost session can resume
without re-exploring. Newest entry at the top.

**Resuming?** Read `CLAUDE.md` first (plan + decisions), then the top entry here (current state).

---

## NEXT UP — resume point for a fresh session

**The product is operable and now has browser coverage.** Buyers search real inventory, enquiries
land in Postgres, and the agent runs the whole thing from `apps/admin`. 170 integration tests plus
26 Playwright tests. **Read `docs/FLOWS.md`** for the journeys and what is missing.

**Standing facts (do NOT re-diagnose):**
- 19 migrations applied. Containers: `tricity-postgres`, `tricity-minio`.
- **TWO database roles.** `DATABASE_URL` = `tricity` (owner, superuser locally, DDL only).
  `APP_DATABASE_URL` = `tricity_app` (serves requests). A superuser ignores RLS — Step 14.
- **`apps/api` must `import type` from `@tricity/contracts`** — CJS cannot require raw TS.
  Step 15.
- **Never `${JSON.stringify(x)}::jsonb`. Always `jsonb(sql, x)`** — postgres.js double-encodes the
  first form, silently. Step 16.
- **Admin token refresh belongs in `proxy.ts`, never in the API client.** Step 17.
- **`@Throttle` only replaces the named limiters it lists.** There are two — `short` (10/sec) and
  `default` — and overriding one leaves the other in force. Step 21.
- **Refresh rotation has a grace window** (`REFRESH_ROTATION_GRACE_SECONDS`, default 10) because
  strict rotation signed out anyone with two tabs. `revoked_at` is checked before `used_at`, and
  the row is locked `FOR UPDATE`. Step 22.
- **A parameter used only in `$n IS NOT NULL` has no inferable type** and fails the whole statement
  at parse time with 42P18. Cast it. Step 21.
- **A new listing is a DRAFT** (`coming-soon` → `PENDING_REVIEW`). Public pages serve only
  `ACTIVE` / `UNDER_OFFER`, and `/listings` on the site additionally requires `is_host`. Publish
  from the listing's Status field. Step 23.
- Dev staff login: `owner@tricityestate.test` / `dev-owner-password-123`. Org `tricity-estate` is
  `is_host` and holds Punjab + Chandigarh RERA registrations (Haryana deliberately absent so the
  publication gate can be exercised).
- A second dev organisation, `e2e-gate-firm`, exists purely so the browser suite can exercise the
  RERA gate against an empty compliance record. Not `is_host`; invisible on the site.

**🔴 ONE KNOWN BUG IS RECORDED AS `test.fail()` IN THE BROWSER SUITE:** React 19 resets the
listing form after a Server Action, so a RERA refusal wipes everything the agent typed except the
price (which survives only because it is controlled for the price echo). See `rera-gate.spec.ts`.
The fix is to echo the submitted values back through `ListingFormState` and re-seed the fields.
⚠️ That test must stay ABOVE the one that registers Punjab — the file is serial and the gate stops
firing once a registration exists.

**Next, in rough priority:**

1. **Fix the form-reset bug above.**
2. **Speed-to-lead auto-WhatsApp** — the highest-ROI feature left, and the reason `phone` is
   weighted so heavily in lead scoring. Needs a WhatsApp Business API account and opt-in language.
   TODO marker is in `leads/services/lead.service.ts`; it must NOT block the lead response.
3. **The launch content blockers** — real agent details and RERA numbers (the launch guard refuses
   to serve a public site until they are filled in), real price bands for the 8 locality guides,
   and OSM polygons to replace the generated circles that currently overlap.
4. **Put the browser suite in CI.** The workflow already runs migrations and the integration
   tests against a Postgres service container; this needs MinIO plus the three servers.
5. **A git remote.** Still none — everything lives on one machine.
6. **Integration coverage for `ListingWriteRepository.update()`** — it had none, which is how a
   statement that could never parse shipped. Step 21.
7. **Identity `repositories/` extraction** — the one module not on the full layered pattern. Port
   its throwaway smoke script into the harness first.
8. **ESLint 9 flat config for `apps/api`** — still none, so `npm run lint` skips the workspace.
9. **`@tricity/geo` has no Panchkula localities**, so no listing can be created in Haryana and the
   Haryana RERA gate is unreachable from the UI. Either add them or drop Haryana from the RERA
   screen.

**Known-good commands:**
```
npm run db:up && npm run db:migrate && npm run db:app-role && npm run db:seed
npm run db:bootstrap -- --email you@example.com --name "You" --org "Firm"
npm run api:dev        # http://localhost:3001/api
npm run web:dev        # http://localhost:3000
npm run admin:dev      # http://localhost:3002
npm test --workspace=@tricity/api      # 170 tests, ~2s
npm run test:e2e                       # 26 browser tests, ~22s, needs all three servers
```

## OPEN QUESTIONS (blocking real content, not blocking code)

- **Agent's real details** — name, firm, RERA registration per jurisdiction, headshot,
  phone/WhatsApp/email. All placeholder in `apps/web/src/config/site.ts`.
- **Real price bands + editorial review** for the 8 locality guides in
  `apps/web/src/config/localities.ts`. Current copy is unverified draft.
- Which additional localities deserve hand-written guides (target 20+).

---

## 2026-08-30 — Step 23: Say when a save worked, and that photos save themselves

Small, and prompted by a user hitting all three of these in one sitting: a new listing did not
appear on the public site, saving gave no feedback at all, and it was not clear how to publish.

None of it was a logic bug. A new listing defaults to Draft (`coming-soon` → `PENDING_REVIEW`) and
the public pages only serve `ACTIVE` / `UNDER_OFFER`, which is correct — the site must not
advertise inventory the agent has not chosen to advertise. But nothing on the screen said so, and
"correct but silent" is indistinguishable from broken.

**An edit that succeeds now says so.** Previously `updateListing` returned `{}` and the page simply
stayed put with the same values in the same fields, so a working save and a save that did nothing
looked identical. That is not a hypothetical resemblance: it is exactly how the completely broken
update path found in step 21 survived hand-testing. The message names the outcome rather than just
confirming — "Saved as a draft. It is not on the public site" closes the loop on the first question
above, and "Saved and published. It is live on the site now" closes it on the third.

`saved` is a TIMESTAMP, not a boolean. React only re-announces a live region when the value
changes, so a boolean would confirm the first save and stay silent on the second — which reads as
the second having failed.

**Photos say they saved, because they save at a different time from everything else.** Choosing a
file IS the upload; the "Save changes" button below belongs to the listing fields and has nothing
to do with the photo grid. The screen never said that, so an agent either waits for a confirmation
that is not coming or clicks Save changes expecting it to commit the photos.

**No redirect after an edit, deliberately.** The edit page is where the work happens — upload
photos, adjust the price, publish — and returning to the list after every save means navigating
back for the next change. Creation is the exception and still redirects to the new listing, because
after creating one the next thing that matters is photos.

Two regression tests: a draft is absent from the agent's own listings page and appears once
published (a stricter check than `/search`, since that page also requires `is_host`), and a photo
upload reports itself. 26 browser tests.

---

## 2026-08-30 — Step 22: A rotation grace window, so two tabs stop killing the session

Fixes the bug step 21 measured and left as a `test.fail()`.

## What was wrong

Refresh tokens rotate, and a token presented twice is treated as theft: the whole family is
revoked. That is the OAuth 2.1 recommendation and it is right. What it misses is that **a browser
has one cookie jar and several tabs.** When the access cookie expires, every tab that touches the
server sends a request carrying the same refresh token — none of them has yet seen the response
that replaces it. The second request is byte-for-byte indistinguishable from a replay.

Measured with a real browser:

```
N=2   1 of 2 requests bounced to /login, session DEAD afterwards
N=3   2 of 3 bounced,                    session DEAD
N=6   5 of 6 bounced,                    session DEAD
```

Two tabs and thirteen minutes of idling. And the request that fails is not the one that caused it,
which is why this class of bug never gets diagnosed from a bug report.

There was a second, closely related instance of the same false positive already in the code. The
old `rotate()` guarded its UPDATE with `used_at IS NULL` and treated the loser of a genuine race as
theft — "two clients presenting the same token at once" was read as an attack, when in a
multi-tab browser it is the normal case.

## Why the fix went in the API, not in `proxy.ts`

The tempting fix is at the BFF: have `proxy.ts` cache old→new for a few seconds so a straggler
gets the replacement. It was rejected for three reasons, each sufficient on its own.

- It only helps requests that reach that one process. The Next docs are explicit that proxy may run
  where module memory is not shared, which is the same weakness the existing single-flight already
  carries and documents.
- It does nothing for consumer sessions. Contacts refresh through the same `TokenService` from a
  different client entirely; a buyer with two tabs has exactly this bug and no proxy in front.
- Token lifecycle belongs to whoever owns the tokens. A workaround in one client leaves the API
  still wrong.

## The fix

`REFRESH_ROTATION_GRACE_SECONDS`, default 10, capped at 60 by the config schema. Within the window
a token that has already been rotated is served instead of being treated as an attack; outside it,
behaviour is exactly as before. This is the mechanism Auth0 calls a "reuse interval" and Okta a
"rotation grace period" — Auth0 defaults to 3s; 10s is chosen for a market on patchy mobile
connections where an in-flight request can take seconds to land.

**The row is now taken `FOR UPDATE`,** which is what makes it deterministic rather than
probabilistic. Concurrent rotations of the same token queue instead of racing: the second
transaction blocks, and when it proceeds it reads a `used_at` the first just committed — freshly
inside the window, so it is graced. There is no longer a lost-race branch at all.

**`revoked_at` is checked BEFORE `used_at`, and the order is load-bearing.**
`auth_revoke_token_family` stamps `revoked_at` on every unrevoked row in the family, used ones
included, so a token whose family was burned by a genuine reuse arrives with both columns set.
Testing `used_at` first would route it onto the grace path and hand a session back to the very
attacker the revocation existed to stop.

**`used_at` is set with `coalesce`, never refreshed.** Otherwise a stream of requests would walk
the window forward indefinitely, turning ten seconds into an unbounded lifetime for a token that
has already been spent.

A graced straggler gets a NEW token rather than a copy of the winner's, because only the hash of
that one is stored — deliberately — so it cannot be handed out again. The cost is a couple of extra
live members in one family during a burst, all belonging to the same real session; the browser
keeps whichever response lands last and the others are never presented. Grace is logged at debug,
not warn: it is the expected shape of a multi-tab client, and at warn it would train everyone to
ignore the line that also reports real theft.

## The security trade, stated plainly

Inside the window, a stolen refresh token replayed gets a session without tripping detection. That
is a real cost. It is bounded to seconds, and weighed against an attacker who by that point already
holds an httpOnly cookie — and against the alternative, which is users being signed out often
enough that the pressure becomes "make the tokens last longer" or "stop rotating", both strictly
worse postures. `0` disables the window for anyone who disagrees.

## Two tests exist so this cannot become "reuse detection is off"

Without them the fix is indistinguishable from having simply deleted the security control, and
silently so:

- **a token replayed after the window still burns the family** — and the family, not just that
  token, because revoking one branch leaves the thief holding another.
- **a signed-out session is not resurrected** — the `revoked_at`-before-`used_at` ordering above.

The first ages `used_at` with SQL rather than sleeping through the window. An
`await setTimeout(11_000)` in a suite that runs in twenty seconds is bad enough; worse, a sleep
long enough to be correct today silently stops being correct the moment someone raises the setting.

## Also fixed here

The expected-failure test for the React 19 form reset was sitting AFTER the test that registers
Punjab for the gate organisation. The file is serial, so by the time it ran the gate no longer
fired, and it was spending fifteen seconds waiting for an error banner that was never coming —
still reporting as an expected failure, so the mistake was invisible. Moved above, and given a 2s
timeout. Suite is down from 32s to 19s.

---

## 2026-08-30 — Step 21: Browser tests, and the four bugs they found on the first run

**`e2e/` — 22 Playwright tests against the real dev stack.** Chosen over the other candidates
because the previous three commits were *all* bugs that passed every one of the 170 integration
tests and were only found by someone opening the page.

## Why a browser suite was the right next thing

The three photo bugs of step 20 share a shape: **the server was right and the product was broken.**
A CORP header the browser enforces and the server never sees. An optimizer returning 400 while the
page still renders. A cache tag serving a stale list. None of them is observable from a status
code, and each cost an evening.

So the assertions here are deliberately not about responses. The core one is
`img.naturalWidth > 0` — true only if the browser fetched the bytes, decoded them, AND was allowed
to paint them. All three photo bugs fail that single property.

## What it covers

Photos render on the site (and never through `next/image`); price typed as "1.6 crore" is echoed
as ₹1.6 Cr before saving; publish and edit reach the public site immediately; a draft does not; an
agent sees their own draft's photos while an anonymous caller gets a 404 for the same one; the RERA
gate refuses publication with a way forward and a draft still saves; registering a jurisdiction
unblocks it; an expired access token refreshes silently and the rotated token survives a second
refresh; a crafted `?from=//evil.example` cannot redirect off-site; and an enquiry submitted on the
site arrives in the agent's queue with a working `wa.me` link.

## 🔴 Four real bugs, none of which any existing test could see

**1. Every listing update was a 500 — and the admin never sent one anyway.** Two independent bugs
stacked, the first hiding the second.

`buildPayload` in the admin validated `citySlug`, `localitySlug`, `lat` and `lng` unconditionally.
The edit form deliberately omits all four (location is immutable — a different address is a
different property), so every edit failed validation and returned before calling the API. Those two
errors render against the City and Latitude fields, which do not exist on that form, so **nothing
appeared**: no banner, no request, no log. Save changes looked like it had worked.

Underneath, `ListingWriteRepository.update()` could never have run either. A parameter used only in
`IS NOT NULL` gives Postgres no way to infer its type, so the statement failed to PARSE with
`42P18: could not determine data type of parameter $17` — always, regardless of the patch. No
integration test covers `update()`, and the admin bug meant no request ever arrived to expose it.

Publishing a draft from the edit screen is the normal way a listing goes live. It could not work.

Fixed: `buildPayload` takes a mode and only validates location/area on create; a field error now
always comes with a visible banner so this class cannot be silent again; and every `patch.status`
parameter is cast to `::listing_status`.

**2. `@Throttle` only overrides the limiters it names.** `ThrottlerModule.forRoot` declares
`short` (10 per SECOND) and `default` (120/min). The media route raised `default` to 600/min with a
comment explaining that a listing page pulls a dozen images at once and must not trip the limiter —
but left `short` in force. Measured: 20 parallel requests to one image returned ten 200s and ten
429s. A search page with fifteen cards therefore lost a third of its photos, which is the exact
failure that decorator was written to prevent. Same trap on the staff delivery route. Both now
override `short` as well.

**3. Uploading a photo showed nothing until a hard reload.** `PhotoManager` did
`useState(initialPhotos)`, and React does not reinitialise state when a prop changes.
`router.refresh()` re-rendered the page with the new list; the component kept the array it was born
with. So the upload returned 201 and the grid went on saying "No photos yet" — no error, no
spinner, no photo. The rational response is to upload again, storing another copy each time. It
survived review because a hard reload shows them, which is exactly what anyone testing by hand
does. Fixed with React's documented "adjust state when a prop changes" pattern, keyed on a
signature of the server list so optimistic reordering still works.

**4. Two concurrent requests after token expiry kill the session.** Left as a `test.fail()` rather
than patched, because the remedy is a design call. Measured at N=2, N=3 and N=6: one request is
always bounced and the family is always revoked afterwards. The single-flight in `proxy.ts` only
collapses requests that overlap the exchange; a straggler arriving just after it completes still
carries the old cookie, because the browser has not yet seen the response replacing it. An agent
with two tabs, idle past the 13-minute access-cookie lifetime, is signed out of both. The usual
remedy is a rotation grace interval — Auth0 and Okta both have one — either in `proxy.ts` or,
more correctly, in the API beside reuse detection.

Also recorded as `test.fail()`: **React 19 resets the form after a Server Action**, so a RERA
refusal wipes everything typed except the price, which survives only because it is controlled for
the price echo. Being told "add your registration, or save as a draft" and then finding the form
blank is how an agent decides the tool is not worth using.

## Test-design decisions worth keeping

**Against the dev stack, not a disposable one** — the inverse of `apps/api/test`, and for a
principled reason. The integration suite clones a template database per file because it asserts
things about the schema. These assert things about the browser, and everything they exercise
requires the three processes wired together as the agent uses them. Standing up a parallel stack to
buy isolation would double the moving parts in order to test the wiring between them.

The price is that isolation is earned by discipline: every row carries an `[E2E]` marker and
teardown deletes exactly those, the same way `db:demo` matches `[SAMPLE]`. Cleanup runs before the
run as well as after, because a cancelled run otherwise leaves rows that make the next one fail
ambiguously.

**A second organisation exists for one test.** The RERA gate can only be observed by publishing
into a jurisdiction you are not registered in, and the dev org holds valid Punjab and Chandigarh
registrations. Haryana is deliberately unregistered — but `@tricity/geo` has no Panchkula
localities, so no listing can be created there and the gate is unreachable from the form. Expiring
a real registration for the duration of a test was the alternative, and a crashed run would then
leave the agent silently unable to publish. So `e2e-gate-firm` holds an empty compliance record and
the agent's own is never touched.

**One worker, and it is not caution.** The throttler keys on client IP, and on a dev machine the
site's server-side fetches, the admin's, the browser's images and the tests' own calls are all
127.0.0.1. Three workers exhausted the 10/sec bucket, and a throttled fetch inside a Server
Component does not throw — `apiGet` returns null and the page renders its empty state, so the test
fails with "the listing did not reach the site", which is a false accusation. Same reason logins
are saved as `storageState` rather than repeated: staff login is 10/minute and the suite was
spending all of it.

**Fields are located by `name`, not by label.** The `Field` wrapper puts the hint inside the label,
so the price input's accessible name is the whole sentence about typing "1.45 cr". More to the
point, `name` IS the contract — the Server Action reads `form.get("price")` — so renaming it should
fail a test and rewording a hint should not.

**Cards are matched by listing id, not title.** A buyer-facing card never shows the agent's
internal title; it leads with photo, price, spec line and address. Searching for the title finds
nothing and reads as "the listing is missing".

**Buyers are matched by phone.** `LeadRepository` deduplicates an enquiry onto an existing contact
by phone first, so a hardcoded number attaches the test's enquiry to whoever already owns it — and
teardown, which keys on the e2e email domain, can then never find it. Numbers are randomised, and
must be exactly ten digits or the API rejects them.

Also worth knowing: Next renders a route announcer with `role="alert"`, so a bare
`getByRole("alert")` always matches something in this app.

---

## 2026-08-30 — Steps 18-20: Demo inventory, CI, and three silent photo bugs

Recorded after the fact — these three commits shipped without a log entry, and the commit messages
carry the full reasoning.

**Step 18 (`0e706e9`, `0a58f60`) — a real README and a CI workflow.** The boilerplate README was
replaced, and `.github/workflows/ci.yml` now runs the migrations and the integration suite against
a Postgres service container. There is still no git remote, so nothing has actually executed it.

**Step 19 (`a34c8e0`) — ten demo listings.** Every title prefixed `[SAMPLE]` and every description
says so: publishing invented inventory under a real RERA number would be an advertising offence, so
if this data ever leaks somewhere public it should be obvious rather than plausible. The spread
exercises the product rather than filling a page — plots and SCOs alongside flats, all three
possession states, one under-offer, 42L to 4.2Cr so lakh/crore formatting shows at both ends.
Photos are generated colour fields: no network dependency, no licensing question.

Seeding it surfaced the first photo bug: the public catalog emitted `/media/{storage_key}`, which
leaks the object's bucket key into a public response AND points at a route that serves nothing.
Now `/api/media/{id}/card`, resolved under the caller's tenant context.

**Step 20 (`adaae01`, `99f3298`) — photos were blank everywhere, four different ways.** All four
were invisible to every command-line check, which is what motivated the browser suite in step 21.

1. `next/image` refuses any host not in `images.remotePatterns` and returns
   `400 "url" parameter is not allowed`. The page still renders — just with every photo blank.
   The optimizer should never have been in this path: the API already emits 400/800/1600 WebP at
   upload. Now a plain `<img>` with a real srcset, and `remotePatterns` is empty again.
2. In the admin, a NEW listing is a draft, and the API's media delivery route is `@Public()` — so
   the guard skips verification, `request.principal` is never populated, and the lookup runs as
   ANONYMOUS. RLS then correctly refused a PENDING_REVIEW listing's media even with a valid staff
   token attached. Fixed with a separate authenticated route rather than optional auth on the
   public one.
3. `helmet()` sets `Cross-Origin-Resource-Policy: same-origin` globally, which tells the BROWSER
   to refuse to embed a :3001 response in a :3000 document. Invisible to curl, to fetch-in-node
   and to the API's own tests, because CORP is enforced by the browser and not the server. Public
   media now opts out; the staff route stays same-origin because those are session-scoped.
4. Listing reads are cached 60s so crawler traffic does not turn every hit into a spatial query —
   which meant an agent published a listing, looked at the site, and did not see it. Fetches are
   now tagged and the admin calls a revalidate endpoint after every write, fire-and-forget with a
   3s timeout. `revalidateTag` takes a profile in Next 16 and the recommended `"max"` is wrong
   here: it serves stale content while revalidating, which is the exact behaviour being fixed.
   `{ expire: 0 }` makes the next request blocking-fresh.

---

## 2026-08-30 — Step 17: The admin app — the agent can finally run the site

**`apps/admin` on port 3002.** Sign in, manage inventory, upload photos, work the enquiry queue,
register RERA numbers. Every write path was API-only before this; adding a listing meant
hand-crafting a POST with a bearer token.

## Why a separate app

Not `/admin` inside `apps/web`. The public site is static, cacheable and crawlable; the admin is
entirely dynamic and authenticated. Keeping them apart means the public build never carries admin
code and the admin never has to opt out of caching page by page. The cost is a third deploy
target — worth restating when the deployment question comes back around.

## 🔴 The refresh race — the bug this step really turned on

The obvious design puts token refresh in the API client: call the API, get a 401, refresh, retry.
It is wrong here, and wrong in a way that only appears in production.

**Refresh tokens ROTATE, and a Server Component render CANNOT WRITE COOKIES.** So refreshing
during a render consumes the old token and then throws the replacement away — Next forbids the
cookie write. The *next* request presents a token the API has already seen, the API correctly
treats that as theft, and it revokes the entire token family. The user is signed out everywhere,
roughly fifteen minutes after they last did anything, and the request that fails is not the
request that caused it.

The refresh-race test found it on the first run: eight parallel requests all returned 200, and
then the very next request 500'd with a dead session. That is exactly the shape of bug that never
gets diagnosed from a bug report.

**Refresh now lives in `proxy.ts`**, which runs before rendering and can write both sides —
`request.cookies.set()` so the current render sees the fresh access token, and
`response.cookies.set()` so the browser keeps it. It also means ONE refresh per request instead
of one per API call, which removes the intra-render race outright.

Single-flight is kept for genuinely concurrent requests, **keyed on the refresh token rather than
held in a module-level variable** — a single variable would serialise refreshes across different
users sharing the process, and one could receive the other's tokens.

`apiFetch` now redirects to `/login` on a 401 instead of throwing, so a genuinely dead session
shows a login page rather than a 500.

## Sessions

httpOnly cookies, set by route handlers. The browser never holds a JWT and never learns the API
origin. An access token in localStorage would mean any XSS anywhere on this app exfiltrates
something that can create, edit and unpublish listings — and it would force CORS open.

The access cookie deliberately expires at 13 minutes against a 15-minute JWT, so the server
refreshes early rather than discovering expiry through a 401.

⚠️ **Next 16 renamed `middleware` to `proxy`** — the dev server flags it, the exported function
must be named `proxy`, and per the docs it may run where shared modules are unavailable. The
cookie-name constants therefore live in their own import-free module; importing them from
`session.ts` would drag in `next/headers`, which does not exist in that runtime.

## The screens, and the decisions in them

**Price is typed the way agents speak.** "1.6 crore", "85 lakh", "1,45,00,000" — all parsed
server-side through `parsePriceInput` and echoed back under the field as **₹1.6 Cr** before
saving. Reading 1.6 crore as `1.6` is a 10⁵ error that renders as a plausible number on a public
page, and nobody proofreads a bare numeric input. Parsing happens on the server so a
half-hydrated form cannot post the wrong magnitude.

**Area is entered once**: value, unit, and *which* area it describes. `Area.of()` returns the
conversion factor, persisted per row so a later correction to the marla constant cannot restate
historical listings. Three separate sq ft boxes would have invited mental arithmetic.

**A 403 is read as the RERA gate, not a permissions error.** The form extracts the jurisdiction
from the message and offers "add your {state} registration" plus a reminder that drafts are
always allowed. Without that the agent gets a wall of legal text and no way forward.

**Photo reorder is buttons, not drag-and-drop.** No dependency, works with a keyboard, and the
one ordering decision that matters — which photo is the hero — gets its own explicit button.
Uploads run sequentially so a fifteen-photo gallery dump does not put fifteen multi-megabyte
resizes in flight at once.

**Photos render through a local route handler with a plain `<img>`, never `next/image`.** The
optimizer refetches server-side without the session, and RLS correctly returns nothing for an
unpublished listing — so every draft's thumbnails would break and look exactly like failed
uploads.

**WhatsApp is the primary action on an enquiry, not email**, for the same reason `phone`
outweighs every property attribute in the lead score. `wa.me` needs the number with no `+`, so
the stored E.164 value is stripped — passing it through opens WhatsApp to a blank chat.

**The RERA screen lists all three jurisdictions separately** and treats an expired registration
as blocking rather than as a warning: an expired number in an advertisement is a false claim of
registration, which is worse than none because it looks verified.

## Also in this step

Three staff endpoints that did not exist: `GET /staff/listings/:id` (a STAFF projection — raw
values, drafts included, deliberately not the public one), `GET/PUT /staff/rera` (the repository
had existed since 0016 with nothing exposing it, so the only way to register a number was a
manual INSERT), and `PATCH /staff/leads/:id` with an activity trail.

🔴 **`lead_activity` and `listing_price_history` had no RLS.** A foreign key to a protected table
constrains what may be INSERTED, not who may SELECT — an unjoined `SELECT * FROM lead_activity`
read every organisation's follow-up notes, which is what any "recent activity" screen does. Same
class of gap as `listing_media` in 0018, invisible for the same reason: nothing had written a
row. `0019` delegates both to the parent. Price history reads through `can_view_listing` rather
than ownership, because "reduced by ₹5L" belongs on a public page while draft repricing must not.

Also: `apps/web` was resolving `@tricity/contracts` on workspace-symlink luck — absent from
`transpilePackages`, tsconfig `paths` AND `package.json` while `api-provider.ts` imported a value
from it. And the Tailwind `@theme` block moved to `packages/config/theme.css` so the two apps
cannot drift into different palettes.

## Verified

- **170 integration tests** (was 158), all three apps build clean.
- **6/6 refresh-race checks**: 8 parallel requests all succeed, the session survives, and a
  garbage token redirects rather than 500s.
- **31/31 staff endpoint checks**, 37/37 media, 40/40 catalog.
- Price and area parsing checked against what agents actually type.
- **End to end:** a Chandigarh listing created at "1.6 crore" and "12 marla" comes back on the
  public API as `16000000` rupees and `3267` sq ft with `12 MARLA` echoed and factor `272.25`
  preserved — carrying the **Chandigarh** registration, not the Punjab one.

## Not done

No UI tests. That needs a Playwright decision, and pretending otherwise would be worse than
saying so. `apps/api` still has no ESLint 9 flat config. Identity still lacks a `repositories/`
layer.

---

## 2026-08-30 — Step 16: Listing photos, and a silent data-corruption bug found on the way

**Agents can now upload property photos.** Upload → resize → object storage → serve, with the
delivery path behind RLS. 37/37 media checks, 158 integration tests.

## The pipeline

`POST /api/staff/listings/:id/media` takes multipart, and the request does everything
synchronously: decode, resize into three WebP variants, write to MinIO, mark the row READY.

**⚠️ SYNCHRONOUS IS A DELIBERATE TRADE, not an oversight.** Presigned direct-to-storage upload
plus an async processing queue never blocks Node and is the right answer at volume — but it needs
bucket CORS, a job runner, and a UI that can render "still processing". At the actual scale here
(an agent uploading 10-20 phone photos, watching, wanting to know it worked) each takes a few
hundred milliseconds. The migration path is left open on purpose: `listing_media` already carries
PENDING/PROCESSING/FAILED and an `error_detail` column, so moving processing out of the request
later touches `MediaService` and nothing else.

**Why resize at all:** agents upload straight from a phone camera roll — 4-8 MB, 4032px wide.
Serving that as a listing hero destroys the LCP < 2.5s target on the mobile connections these
buyers are on, and the listing page is where the decision to call gets made. Measured in the smoke
test: a 4032×3024 source came out as a 1600px WebP hero at **~4% of the original bytes**.

Three variants — `thumb` 400w, `card` 800w, `hero` 1600w — plus the original, kept so the variant
set can change later (adding AVIF, a retina hero) without asking agents to re-upload. Throwing the
original away is a one-way door.

## Things that would have been bugs

- **EXIF rotation.** `sharp().rotate()` with no argument applies the orientation tag and strips
  it. Without it every portrait phone photo renders sideways — the pixels really are stored
  landscape and only the tag says otherwise, and resizing discards metadata. The single most
  visible bug in any naive image pipeline. Covered by a test that uploads orientation-6 landscape
  pixels and asserts the output is portrait.
- **Format is determined by DECODING THE BYTES**, never from the filename or the client's
  Content-Type — both are attacker-controlled. **SVG is deliberately absent from the accepted
  formats** despite being an image format: it is a document format that executes, and
  `photo.jpg` containing `<svg><script>` served back with an image content type is stored XSS.
  Tested.
- **Decompression bombs.** A 436KB PNG can declare 12000×12000 and allocate gigabytes on decode.
  The byte-size limit does not catch this at all, because the *compressed* file is small. Guarded
  on declared megapixels before any pixels are decoded. Tested.
- **Keys contain no user-supplied text.** Not the filename, not the caption — a filename arrives
  from a browser with whatever the OS allowed, including `../`, and a key is a path. Both segments
  are server-generated uuids. The listing id leads the key so a listing's objects can be swept by
  prefix.
- **Dedup by SHA-256 of the original.** Agents re-upload the same photo constantly — camera roll,
  WhatsApp forward, a listing they copied. Identical bytes return the existing row instead of a
  duplicate gallery entry and a redundant resize.

## RLS on `listing_media` (0018)

The table **was not under RLS at all**, which only escaped notice because nothing had ever written
a row. Media rows now carry object keys, and for a PRIVATE or DRAFT listing a storage key is
effectively the file's address. Without a policy any org could enumerate every rival's photo keys.

The policy delegates to the parent listing via `can_view_listing` rather than restating tier
logic — media inherits the visibility of the thing it depicts, and duplicating those rules would
be a second place to get them wrong. Delivery is a **proxy, not a redirect to a bucket URL**, for
exactly this reason: `streamVariant` resolves the row under the caller's tenant context first.

## 🔴 The real find: jsonb was being double-encoded, silently

`${JSON.stringify(value)}::jsonb` looks obviously correct and is obviously wrong.

**postgres.js JSON-encodes a string parameter bound to a json/jsonb column.** A pre-stringified
value is therefore encoded twice, and the column holds a JSON **string** rather than an object or
array — `jsonb_typeof` returns `'string'`.

Nothing fails. The INSERT succeeds, the read returns a string, and the listing mapper's defensive
`Array.isArray(raw) ? ... : []` — written to survive a hand-edited row — converted the corruption
into a plausible empty array. So `listing.features` looked merely *absent*.

The part that would have hurt: the public search filters features with `@>` containment. Against a
double-encoded column that matches nothing, so the filter appeared to work while silently
excluding every listing.

Affected **`listing.features`, `lead.requirement`, `lead.source` and `listing_media.variants`** —
i.e. it had already shipped in two modules. Fixed by `database/json-param.ts`; the rule is now
**always `jsonb(sql, value)`, never `JSON.stringify(...)::jsonb`**.

`test/jsonb-encoding.spec.ts` guards it, and asserts on **`jsonb_typeof`, not on round-tripped JS
values** — that distinction is the whole point, because a double-encoded column round-trips
through `JSON.parse` perfectly and looks fine from the application side. It also keeps the broken
idiom as an executable counter-example, so anyone tempted to "simplify" back can see the result
rather than take it on trust.

## Also fixed

- **Route ordering.** `@Get(":mediaId/:variant")` was declared before `@Get("listings/:listingId")`,
  so `/media/listings/{uuid}` bound `mediaId="listings"` and never reached the literal segment. It
  surfaced as `invalid input syntax for type uuid` deep in the driver, pointing at the repository
  rather than the routing table. Exactly the trap called out in `PublicCatalogController` — written
  down, then walked into anyway. Caught by the smoke test.
- **`@types/multer` needs `"multer"` in the tsconfig `types` array.** With an explicit `types`
  list, @types packages are not auto-included, so the `Express.Multer.File` global augmentation is
  invisible. And it must be repeated in `tsconfig.spec.json` — an explicit `types` array REPLACES
  the inherited one rather than merging.

## Verified

- 37/37 media smoke checks against the live API.
- 158/158 integration tests (152 + 6 new jsonb guards).
- Bucket auto-created on boot. `ObjectStorageService` deliberately does **not** throw when storage
  is unreachable — unlike the RLS role check, which must refuse to serve traffic. Photos being
  down should not take search and lead capture down with them.

## Still not built

**The admin UI.** Everything above is API-only; the agent still cannot upload a photo without
curl. That is the next step, and it is now the only thing between this and a usable product.

---

## 2026-08-29 — Step 15: Catalog + leads modules, ApiProvider, and the three launch blockers closed

**The two halves are now one product.** The website reads real inventory from Postgres, forms write
leads to Postgres, and the layered module structure is in place.

## Layered module structure

`catalog/` and `leads/` are the reference implementation of the convention:

```
<module>/
  controllers/   HTTP only — parse, delegate, map null to 404. No decisions.
  services/      business rules: the RERA gate, sample-size thresholds, clamps
  repositories/  the ONLY place SQL is written; every method goes through withTenant()
  mappers/       row -> wire. Pure, synchronous, testable with a literal object
  dao/           row shapes — hand-written assertions the compiler cannot verify, isolated
  dto/           inbound validation at the edge
  utils/         pure helpers: enum translation, SQL fragment composition
```

The point is that the tenant rule becomes **greppable**: SQL outside `repositories/` is wrong, and a
repository method without `withTenant` is wrong. "Be careful" does not scale; a directory does.

`identity/` was restructured to match (controllers/, services/, guards/, dto/, utils/) and its
two-controller file split in two.

⚠️ **One deliberate deviation:** identity has no `repositories/` yet — its services still hold their
own SQL. Refresh rotation and reuse detection are subtle and covered only by a throwaway smoke
script, so extracting them is a real refactor rather than a file move. Queued, not bundled into a
structural change.

## Three migrations, each closing a gap found by writing the mapper

- **`0015_catalog_gaps`** — `possession` (**the most-used filter in this market**, ahead of price
  band, and it did not exist at all), `reference_code` via a sequence DEFAULT, `price_on_request`,
  `close_price`/`closed_at`, `pincode`, `project_id`, `lead.kind`.

  Also **`area_input_basis`**: the schema recorded *that* the seller typed "10 marla" but not
  **which** area it referred to. Without it the UI cannot tell whether to echo that beside the plot
  area or the carpet area — and echoing it against the wrong one is a false statement about the
  property, not a formatting quirk.

- **`0016_rera_registrations`** — 🔴 **an organisation could hold only ONE RERA registration.**
  The tricity is three jurisdictions inside 20 km (Punjab RERA; Chandigarh, a UT with its own
  authority; Haryana for Panchkula) and an agent working across it holds a separate registration
  for each. Showing the Punjab number on a Chandigarh listing is advertising that property without
  a valid registration for the authority that governs it — the ₹10 lakh failure, not a display bug.

  Now one row per (org, state), resolved per listing by joining on the **city's** state. Read is
  world-open on purpose: a RERA number is *mandated public disclosure*, and hiding it behind tenant
  scoping would break the one page it is legally required to appear on. Writes stay tenant-scoped.

  Also `organization.is_host` with a partial unique index — at most one host.

- **`0017_public_sold_history`** — the public catalog admitted only PUBLIC+ACTIVE, so
  `getOwnListings({ includeSold })` was asking for rows no anonymous visitor could read. Widened to
  UNDER_OFFER for everyone, and SOLD/RENTED **for the host organisation only** — a partner's
  `close_price` is not ours to publish to their rivals.

  ⚠️ Fourth revision of `can_view_listing`. SECURITY DEFINER, the pinned search_path and the 0014
  coalesce are all restated in full, because CREATE OR REPLACE resets function attributes.

## The RERA publication gate

`ListingAdminService.assertPublishable()` blocks a listing going ACTIVE unless the organisation
holds a **valid, unexpired** registration for **that listing's own jurisdiction**. Drafts are always
allowed — an agent waiting on their Chandigarh registration should still be able to prepare
inventory, and blocking the draft pushes them to enter it somewhere else instead. An expired
registration counts as none: an expired number in an advertisement is a false claim of
registration, worse than having none because it looks verified until someone checks.

Verified live: publishing in Mohali with no registration → 403 naming Punjab; add the Punjab
registration → 201; the same listing in Chandigarh → still 403 naming Chandigarh.

## The three launch blockers, closed

1. **Leads were being lost.** `FileLeadStore` appended to `.data/leads.jsonl` on local disk —
   silent data loss on Vercel or any rescheduled container: the write succeeds, the form says
   "thank you", and the record is gone at the next deploy. Now `ApiLeadStore` → Postgres, and
   `getLeadStore()` **throws in production** when `API_URL` is unset rather than falling back to
   the file. Crashing on boot is recoverable in minutes; silently dropping leads is not
   recoverable at all.

2. **The site would have published invented inventory.** `ApiProvider` is built. The factory now
   accepts `api`/`mock` and **hard-fails on any other value** — a typo like `LISTING_PROVIDER=API`
   silently serving fabricated listings on a site presenting itself as real is a RERA advertising
   problem, not a config annoyance.

3. **Placeholder agent details.** `config/launch-check.ts` refuses to serve a public site while
   `"Your Name"` / `"PBRERA-XXXXXX-XXXX"` remain. Gated on `NEXT_PUBLIC_SITE_URL` rather than
   NODE_ENV, so previews and CI still build — blocking those would make the check something people
   route around. Verified: `NEXT_PUBLIC_SITE_URL=... next build` fails and names all three
   jurisdictions separately.

## 🔴 Bugs found while building

- **`packages/contracts` had `"type": "module"`** — the exact trap CLAUDE.md warns about, latent
  because nothing had ever imported it. Removed.

- **A CommonJS app cannot import raw-TS workspace packages at runtime.** `apps/api` compiles to
  `require()`, the packages ship `.ts`, and Node cannot require TypeScript — so any *value* import
  from `@tricity/contracts` passes `tsc` and then dies at boot with `ERR_MODULE_NOT_FOUND` on an
  extensionless specifier. The rule for `apps/api` is now **`import type` only**, with the one
  runtime helper duplicated locally and `catalog-contract.spec.ts` round-tripping the real encoder
  through the real DTO so the two cannot silently drift.

- **`forbidNonWhitelisted` rejected the documented `?area=` parameter** because the DTO property was
  named `localities`. Every locality-filtered search 400'd with "property area should not exist",
  which reads like a validator bug rather than a naming mismatch. DTO properties must match wire
  keys.

- **`search()` read a `total_count` the projection never selected** — caught before it shipped.

- **`reflect-metadata` is not loaded in vitest**, so any suite importing a DTO died with
  `Reflect.getMetadata is not a function` pointing at a decorator. Added as a setup file.

## Verified end to end

- **152/152 integration tests** (was 132): +14 contract round-trip, +6 host-only sold history.
- **40/40 catalog smoke checks** against the live API: the RERA gate in both directions, drafts
  excluded from public results, rupees not lakh, `TE-` reference codes, marla echoed on the plot
  area and *not* on the carpet area, coordinates not transposed, `area=mohali/phase-7` matching
  while `area=chandigarh/phase-7` correctly does not, map bounds, leads persisting and ranking.
- **The website served real Postgres inventory** with `LISTING_PROVIDER=api`: `/listings` and
  `/search` rendered the seeded kothi as **₹1.45 Cr** with the real `PBRERA-SAS81-AG-0042`.
- **A lead submitted through the website reached Postgres** — scored 70, phone normalised to
  `+919876500099`.
- `npm run build` clean for both apps; API and web typecheck clean.

## Still not built

**No admin UI** — inventory and leads are API-only, so the agent cannot use this day to day.
**No media upload** — `listing_media` exists but there is no upload path or object storage, and
photos are the biggest conversion factor on a listing page. Both are now the largest gaps.
See `docs/FLOWS.md` for the full picture.

---

## 2026-08-29 — Step 14: The first real test found that RLS was still switched off entirely

**132 integration tests, and the first run failed 11 of them.** Not because the tests were wrong.

## 🔴 ROW-LEVEL SECURITY WAS A COMPLETE NO-OP. AGAIN. FOR A DIFFERENT REASON.

Step 12 found that `ENABLE ROW LEVEL SECURITY` alone does nothing when the app connects as the
table owner, and added `FORCE ROW LEVEL SECURITY` to fix it. That was necessary and **it was not
sufficient**, which nobody could have known without running a query as one org and asking for
another org's rows.

**A SUPERUSER BYPASSES ROW-LEVEL SECURITY UNCONDITIONALLY. So does any role with `BYPASSRLS`.
`FORCE` does not apply to them.** The check is skipped before policies are ever consulted — there
is no policy, no `GRANT`, and no schema change that can stop it.

The `postgis/postgis` image makes `POSTGRES_USER` a superuser. So `tricity` — the role in
`DATABASE_URL`, the role the API connected as — had `rolsuper = t, rolbypassrls = t`, and every
policy in 0010 was inert. An organisation could read, update and delete every rival's listings and
leads. The schema was word-for-word what the design called for, `\d listing` showed
`Policies (forced row security enabled)`, and none of it did anything.

What the failing tests actually showed: an unrelated third org could `SELECT` a partnership it was
not party to, a partner could `UPDATE` its own tier to `FULL`, and a query with **no tenant
context at all** returned every listing in the database.

### The fix is a second role, because the problem is not a permission

`0013_app_role.sql` creates `tricity_app` — `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, no DDL,
DML grants only. The `ALTER ROLE` in the idempotent branch is deliberate: re-running migrations
takes `SUPERUSER`/`BYPASSRLS` back off a live role rather than leaving the hole open.

Two connection strings now, and they are **not interchangeable**:

| | role | used by |
|---|---|---|
| `DATABASE_URL` | `tricity` (owner, superuser locally) | migrations, seed, bootstrap — DDL only |
| `APP_DATABASE_URL` | `tricity_app` | **everything that serves a request** |

The role is created `NOLOGIN`: a migration must run anywhere and must not invent credentials.
`npm run db:app-role` sets the password from `APP_DATABASE_URL` and verifies the result. It builds
the `ALTER ROLE` via `format('... %I ... %L', ...)` **inside Postgres** — `ALTER ROLE` is a utility
statement and takes no bind parameters, so the password has to reach the server inside SQL text,
and the server's own quoting is a better answer than hand-rolled escaping.

Two grants that are easy to miss and both fail loudly at runtime rather than at migration time:
`can_view_listing` and the three `auth_lookup_*` functions were `REVOKE`d from `PUBLIC` (correctly
— they are `SECURITY DEFINER`), so the runtime role needs them granted back explicitly or the
listing policy itself errors and login cannot look a user up. And `ALTER DEFAULT PRIVILEGES`, or
every table added by a future migration would be invisible to the API.

**The runtime role has no `CREATE` on the schema.** That is the second half of the 0012 defence:
0012 pins `search_path` on the definer-rights functions, and this removes the ability to plant a
shadowing object on any path at all.

### The guard that makes it unrepeatable

`assertRuntimeRoleCannotBypassRls()` runs in `DatabaseService.onModuleInit` and **refuses to
boot** if the connected role is a superuser or has `BYPASSRLS`. Not a warning and not a health
check: this failure mode produces no error, no log line and entirely correct-looking results, so
the only place it can be caught is before the first request. `APP_DATABASE_URL` falls back to
`DATABASE_URL` when unset purely so an existing checkout still starts — and then fails at this
assertion with instructions, which is the intended outcome rather than a silent downgrade.

## 🔴 Second bug: `can_view_listing` returned NULL, not false

Found by the exhaustive matrix, on the anonymous row. `current_org_id()` is NULL when unset, so
`l_org_id = current_org_id()` is NULL, and `false OR NULL OR false OR false` is NULL in
three-valued logic. Only the public-catalog branch rescued it, because `NULL OR true` is true —
which is exactly why public browsing worked and nothing looked wrong.

**Not a leak**, because a policy's `USING` clause treats NULL as false, so it failed closed in the
one place it is currently used. That is luck, not design. The function is granted to the runtime
role and is an ordinary callable predicate; the moment anyone writes `NOT can_view_listing(...)` —
an "inventory I cannot see" admin report, an exclusion filter, a CHECK — the answer is NULL, which
is not true, and the query silently returns nothing. `0014` wraps it in `coalesce(..., false)`.

⚠️ `CREATE OR REPLACE FUNCTION` resets a function's attributes to whatever the command states, so
0014 repeats `SECURITY DEFINER` and the pinned `search_path` in full. Omitting either would have
silently undone 0012.

## The test harness

`test/support/database.ts`. **Testcontainers was the plan and is the wrong trade here.** These
tests assert things about the *schema*, so what they need is a real Postgres with our migrations
on it — which the dev Compose stack already provides. Testcontainers would add a heavyweight
dependency and 5-15s of container start to buy an isolation guarantee `CREATE DATABASE` gives for
free. If CI needs a container it is one `services:` block in the workflow, not a code change:
everything keys off `DATABASE_URL`.

A **template database** is built once per `vitest` run (globalSetup: migrate + seed), and each
test file clones it with `CREATE DATABASE ... TEMPLATE`, which is a file copy. Per-suite isolation
therefore costs almost nothing, so there is no incentive to share a database between suites — and
a suite that leaked a stray organisation would otherwise silently change another suite's result.
`DROP ... WITH (FORCE)` on teardown, because one leaked connection would otherwise cascade into
every later test failing for an unrelated reason. **Full run: 1.6s.**

⚠️ **The suites connect as `tricity_app`, not the owner.** This is the whole ballgame: as a
superuser every assertion in `rls.spec.ts` passes against a schema with no isolation whatsoever —
thorough-looking and worthless. There is a consequence worth knowing: the runtime role is *not*
the table owner, so it would be subject to policies even if `FORCE` were removed. Behaviour alone
can no longer detect a missing `FORCE`, which is why `rls.spec.ts` asserts `relforcerowsecurity`
against `pg_class` directly.

Fixtures write through `asTenant` rather than bypassing RLS, so setup is subject to the same
policies as production — a fixture that cheats can build a world the application could never
produce and then "prove" something about it.

## What is now covered — 132 tests

- **`rls.spec.ts`** — cross-tenant read both directions, anonymous, aggregate counts (a leak
  through `COUNT(*)` would expose inventory volume, itself commercially sensitive), cross-tenant
  `UPDATE`, `WITH CHECK` on a forged `organization_id`, `app_user` scoping, platform-admin
  override, missing tenant context degrading to *fewer* rows rather than more, partner
  self-promotion to `FULL` being blocked, and `ENABLE`+`FORCE` asserted against `pg_class`.
- **`can-view-listing.spec.ts`** — all 108 (4 tiers × 3 visibilities × 9 statuses) combinations
  plus owner / stranger / anonymous / platform-admin, and that a `PENDING`/`SUSPENDED`/`REVOKED`
  partnership drops a `FULL` partner back to the public catalog. Expectations are computed from an
  **independent restatement** of the rule, not transcribed from the SQL, so it is a real second
  opinion. Hardening assertions too: every `SECURITY DEFINER` function in `public` pins its
  `search_path` (written over `pg_proc`, not a hardcoded list, so a function added later is
  covered), and `can_view_listing` is not executable by `PUBLIC`.

`tsconfig.spec.json` typechecks `test/` — `tsconfig.json`'s `include` stays limited to `src/**/*`
so `nest build` cannot emit spec files or test-only database-dropping helpers into a production
image. Verified: `dist/` contains `src` only.

## Verified

- 132/132 integration tests, 1.6s.
- The 28-check identity smoke pass still green **through the restricted role** — proving the
  grants in 0013 are complete, including the `SECURITY DEFINER` re-grants.
- API boots and logs `Database role verified: row-level security applies to this connection.`
- `nest build` clean, `tsc -p tsconfig.spec.json` clean.

## Known gap, not addressed

`apps/api` has **no ESLint 9 flat config**, so `npx eslint src test` cannot run at all and
`npm run lint` cannot cover this workspace. Pre-existing, unrelated to this step, and left alone
rather than folded into a security change.

---

## 2026-08-29 — Step 13: First contact with a real database — schema runs, identity works, 3 bugs

**The 11-migration wall came down.** Docker started, the schema built, and every line of the
identity module ran against real Postgres for the first time. The migrations themselves were
close to clean; the interesting failures were all in the layer *above* them, and none of them
were the ones anticipated.

### Migrations: better than expected, one real fix

All 12 applied. `0011_auth_lookup.sql` and `0005_catalog.sql` — flagged as highest-risk because
they were written last and never parsed — both went through without edits.

`0012_pin_search_path.sql` was added: `can_view_listing()` is `SECURITY DEFINER` but was created
**without a pinned `search_path`**, while all three functions in 0011 pin theirs. An unpinned
definer-rights function resolves its own identifiers through the *caller's* `search_path`, so
anyone able to create objects in an earlier-resolving schema can shadow `partner_relationship`
and answer "may this org read this listing" themselves — with owner rights. That is the entire
cross-tenant boundary.

**This is not hypothetical here.** The `postgis/postgis` image sets a database-level
`search_path = "$user", public, topology, tiger`, so this database ships with extra schemas ahead
of nothing and a `$user` slot that resolves first. Verified after the fix — all four
`SECURITY DEFINER` functions now report `search_path=pg_catalog, public`.

A new migration rather than an edit to 0010: the runner checksums applied files and rejects
changed ones, which is the behaviour we want even when the file is one commit old.

### 🔴 Three bugs found by running the code

**1. Drizzle silently corrupts a shared postgres.js client — and it presents as a driver crash.**

`drizzle(sql)` reaches into the client it is handed and overwrites `options.serializers` and
`options.parsers` **in place**, for every query that client will ever run, including raw tagged
templates Drizzle knows nothing about. It swaps the handlers for json/jsonb and the date/time
OIDs for the identity function, because it does its own mapping.

Sharing one client therefore breaks raw SQL in both directions: binding a `Date` throws
`ERR_INVALID_ARG_TYPE ... Received an instance of Date` from inside postgres.js with a stack that
points at driver internals, and reads come back as **strings typed as `Date`** — so every
`row.expires_at.getTime()` in the identity module (OTP expiry, token expiry, resend cooldown) is
a runtime TypeError that `tsc` cannot see, because the row type is a hand-written assertion.

This is exactly how the OTP endpoint failed on its first ever call. The two regimes cannot be
reconciled on one client — Drizzle *requires* the identity parsers — so they now get separate
clients. Drizzle's is lazy: nothing uses it yet (the identity module is all raw SQL), so it costs
zero connections until something does. `DatabaseService.db` became a getter for that reason, and
`close()` shuts both pools.

**2. `/auth/staff/me` accepted a CONSUMER's token.**

The guard only enforces a principal kind when the route asks for one, and `/me` had no
`@StaffOnly()`. A buyer who signed in by phone OTP held a signed, unexpired, entirely valid token
that the staff endpoint answered — reporting `role: "CONTACT"` rather than refusing. The next
staff route added would have inherited the same default.

Fixed by moving `@StaffOnly()` / `@ContactOnly()` to the **class**, so safe is the default and a
new route has to opt *out* to be wrong. `@Public()` routes still work — the guard reads handler
metadata ahead of class metadata and returns before the kind check.

**3. Nothing loaded `.env`.**

`@nestjs/config` was removed in step 11 (its v12 line is pure ESM, unimportable from this CJS
app) and nothing replaced its file loading. Every entrypoint saw an empty `DATABASE_URL` and died
blaming the operator for a missing file that was sitting right there.

`config/load-env.ts` uses `util.parseEnv` rather than `process.loadEnvFile()` **because
loadEnvFile overwrites variables that are already set** — in a real deployment config arrives
from the platform, and a stray `.env` winning over an injected `DATABASE_URL` is how a staging
process ends up writing to a dev database. Here, existing values always win. It walks up to the
workspace-root `package.json` rather than using a fixed relative hop, because the file runs from
two different depths (`apps/api/src/config` under tsx, `apps/api/dist/apps/api/src/config`
compiled, since `rootDir: "../../"` is mirrored under outDir) — a hardcoded hop is correct in
exactly one of the two and silently resolves to nothing in the other.

Also: `.env.example` had drifted badly out of sync with the zod schema — it advertised RS256
keypairs (`JWT_PRIVATE_KEY_BASE64`) when the code uses HS256 secrets, plus `API_PORT` for `PORT`
and `CORS_ALLOWED_ORIGINS` for `CORS_ORIGINS`. Copying it produced a boot failure on every
variable. Rewritten against the schema.

### `db:bootstrap` — the first admin had no way to exist

There is deliberately no staff-registration route (an open door onto the tenant that owns the
platform), and staff are created by invitation — which leaves nobody able to invite the first
admin. `seed/bootstrap-org.ts` is a one-shot operator command that closes the gap without adding
anything reachable over HTTP. A hardcoded default credential was the alternative, and that is the
most reliably exploited misconfiguration there is.

It writes `app_user` inside a transaction that sets `app.current_org_id` to the new org, so the
insert satisfies `app_user_tenant_policy`'s `WITH CHECK` **honestly** — `app.is_platform_admin`
would also work and is deliberately not used, since it would grant the script write access to
every table in the schema in order to insert one row. Idempotent on the organisation, but an
existing user email is a hard error rather than a silent password reset: "bootstrap ran twice"
and "someone is resetting the owner's credentials" are indistinguishable from inside the script.
With no `--password` it generates 144 bits and prints it once.

### Verified against live Postgres

28/28 checks in an end-to-end smoke pass — staff login (wrong password, unknown user, and short
password all distinguishable only in the ways intended), staff `/me`, phone-OTP request → verify
→ replay-rejected, contact password linking and login, **principal-kind separation in all three
directions**, and refresh rotation where presenting a used token kills the whole family. The
account-enumeration defence holds: unknown user and wrong password return byte-identical bodies.

PostGIS is real. `PostGIS_Version()` → `3.4 USE_GEOS=1 USE_PROJ=1 USE_STATS=1`, and an
`ST_Intersects` against `locality.boundary` picks `locality_boundary_idx` (GiST) **naturally**,
without needing `enable_seqscan=off`, even at 102 rows.

**⚠️ That query also confirmed the generated-boundary problem empirically:** a point in central
Chandigarh falls inside **two** localities (Sector 27 and Sector 33), because the boundaries are
overlapping circles from the grid model. Any "which locality is this in?" lookup will return
multiple answers until real OSM polygons replace them. Do not build locality resolution assuming
a single hit.

### Still not covered

**Every one of these bugs was found by hand.** There is still no automated test in the repo, and
in particular nothing verifies that `FORCE ROW LEVEL SECURITY` bites — the one that already
shipped broken once. That is the next step, ahead of any new feature.

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
