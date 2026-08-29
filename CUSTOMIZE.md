# How to make this site yours

Plain-English guide. You only need to touch a handful of files — the rest of the site reads from
them automatically.

---

## 1. Your details — `src/config/site.ts`

Open this file and replace the placeholders. Change it here once and it updates the header,
footer, every page, and the legal disclosures.

| What | Where in the file | Notes |
|---|---|---|
| Your name, title, phone, email | `agent` | |
| Your license number | `agent.licenseNumber` | Legally required on marketing material |
| Your bio and tagline | `agent.bio`, `agent.tagline` | |
| Brokerage name, address, license | `brokerage` | |
| Your city and state | `market` | |
| Map starting point | `market.center` | Latitude/longitude of your city centre |
| Social links | `social` | Leave blank to hide |

**Your photo:** save it as `public/agent/headshot.jpg`.

---

## 2. Your neighborhoods — `src/config/neighborhoods.ts`

**This is the most important file for getting found on Google.**

About 72% of buyers search by neighborhood name, and the big portals rank badly for those
searches. This is where you can beat them. Three placeholder neighborhoods are in there now —
replace them with the areas you actually work.

For each one you write:

- `slug` — the web address, e.g. `oak-hill` becomes `yoursite.com/neighborhoods/oak-hill`.
  **Once the site is live, don't change these** — you'd lose the Google ranking you built.
- `name`, `tagline` — display name and a one-line summary
- `intro`, `lifestyle` — the real writing. Be specific: name streets, parks, schools, the
  actual character of the place. **Generic filler will not rank.** This is the part no portal
  can copy, and it's genuinely the difference between page 1 and page 5.
- `center`, `radiusKm` — where it sits on the map
- `priceRange`, `housingTypes` — typical prices and what kind of homes
- `highlights` — bullet points, kept concrete
- `faqs` — real questions buyers ask you, answered properly. Google pulls answers straight
  out of these, so they earn their space.

**Aim for 20 to start, then grow toward 40.** Each one is another way for someone to find you.
It takes 6–12 months to rank, so the sooner these are real, the better.

---

## 3. Your story — `src/app/about/page.tsx`

Replace the placeholder bio text and, importantly, the **testimonials**. The ones in there now are
obvious placeholders.

> ⚠️ Use only real, permissioned client quotes. Invented testimonials on a real estate site are a
> trust problem and, in most states, a licensing one.

The stats block (years in business, homes closed) shows `—` until you fill it in. If you'd rather
not show numbers, delete the section.

---

## 4. Going live with real MLS listings

Right now the site shows **realistic sample listings**, clearly labelled as such. To show real ones:

1. **Ask your broker for an IDX feed.** Say: *"I need an IDX data feed for my website under our
   brokerage's IDX agreement — ideally RESO Web API access."* Approval usually takes 1–3 weeks.
2. Your broker or MLS gives you API credentials.
3. Your developer implements `src/lib/listings/reso-provider.ts` and sets `MLS_PROVIDER=reso`.
   The site was built for this — **no page or design changes are needed.**
4. Copy your MLS board's **exact** disclaimer wording into `site.compliance` in
   `src/config/site.ts`. Boards enforce this word-for-word.

**Safety feature:** until you set a real website address in `NEXT_PUBLIC_SITE_URL`, the site tells
Google not to index it. That prevents sample listings being published as though they were real.
Set that variable when you're genuinely ready to launch.

---

## 5. Where your leads go

Every form submission is saved to `.data/leads.jsonl` and scored 0–100 so you know who to call
first. A tour request with a phone number scores in the 90s; a casual saved-search signup scores
in the teens.

**Before launch you'll want:** these forwarded to your phone/email or pushed into a CRM, plus the
automatic text-back to new leads. That's the single highest-return thing left to build — responding
within minutes rather than hours is worth more than any other feature on this list.

---

## Running the site

```bash
npm run dev     # preview at http://localhost:3000
npm run build   # production build
```

## Reading order for a developer picking this up

1. `CLAUDE.md` — architecture and decisions
2. `docs/BUILD_LOG.md` — what's built, what's next
