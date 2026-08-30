import { randomUUID } from "node:crypto";
import postgres from "postgres";
import sharp from "sharp";

import { loadEnvFile } from "../../config/load-env";

/**
 * Demo inventory — realistic-looking listings so the site can be shown to someone.
 *
 * ⚠️⚠️ THIS IS FABRICATED DATA AND IT MUST NEVER REACH A PUBLIC SITE.
 *
 * Every listing gets a title prefixed `[SAMPLE]` and a description that says so. That is not
 * decoration: publishing invented inventory under a real RERA registration number is an
 * advertising offence, not a cosmetic problem, and the whole reason `isLiveData` and the launch
 * guard exist. The prefix means that if this data ever does end up somewhere public, it is
 * obvious at a glance rather than plausible.
 *
 * ⚠️ THE PRICES ARE PLAUSIBLE, NOT RESEARCHED. They are in the right order of magnitude for each
 * locality and nothing more. Do not quote them, do not use them to sanity-check the real price
 * bands in `apps/web/src/config/localities.ts`, and do not let them become the source of anything.
 *
 * Run with:  npm run db:demo
 * Remove with: npm run db:demo -- --clean
 */

/**
 * Photos are GENERATED, not stock imagery.
 *
 * Downloading real photos would mean a network dependency in a seed script and a licensing
 * question nobody wants to answer later. These are flat colour fields with the locality written
 * on them — they exercise the whole pipeline (decode → resize → three WebP variants → MinIO →
 * RLS-checked delivery) and they are unmistakably not photographs, which is the honest outcome.
 */
async function generatePhoto(label: string, subtitle: string, hue: number): Promise<Buffer> {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="hsl(${hue}, 32%, 46%)"/>
          <stop offset="100%" stop-color="hsl(${hue}, 38%, 26%)"/>
        </linearGradient>
      </defs>
      <rect width="1600" height="1200" fill="url(#g)"/>
      <text x="50%" y="46%" text-anchor="middle" fill="rgba(255,255,255,0.95)"
            font-family="sans-serif" font-size="86" font-weight="600">${label}</text>
      <text x="50%" y="56%" text-anchor="middle" fill="rgba(255,255,255,0.72)"
            font-family="sans-serif" font-size="44">${subtitle}</text>
      <text x="50%" y="92%" text-anchor="middle" fill="rgba(255,255,255,0.55)"
            font-family="sans-serif" font-size="30" letter-spacing="4">SAMPLE IMAGE</text>
    </svg>`;

  // Rendered to JPEG so the upload path decodes a real photographic format rather than being
  // handed something the pipeline would treat specially.
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

interface DemoListing {
  citySlug: string;
  localitySlug: string;
  propertyType: string;
  transactionType?: string;
  title: string;
  description: string;
  /** Rupees. */
  price: number;
  possession: string;
  areaValue: number;
  areaUnit: "MARLA" | "KANAL" | "SQ_YD" | "SQ_FT";
  areaBasis: "PLOT" | "BUILT_UP" | "CARPET";
  bedrooms?: number;
  bathrooms?: number;
  floorNumber?: number;
  totalFloors?: number;
  facing?: string;
  furnishing?: string;
  yearBuilt?: number;
  maintenance?: number;
  features: string[];
  status?: string;
  hue: number;
}

const SQ_FT_PER_UNIT: Record<string, number> = {
  MARLA: 272.25,
  KANAL: 5445,
  SQ_YD: 9,
  SQ_FT: 1,
};

/**
 * A spread chosen to exercise the product, not just to fill a page: plots and kothis alongside
 * flats (plots are a large share of transactions here and most portals model them badly), all
 * three possession states, one under-offer and one sold so the status pills and the sold-history
 * page have something to show, and a range from a ₹42L builder floor to a ₹4.2Cr kanal kothi.
 */
const LISTINGS: DemoListing[] = [
  {
    citySlug: "mohali", localitySlug: "phase-7", propertyType: "kothi",
    title: "4 BHK kothi, corner plot near the park",
    description:
      "East-facing corner kothi on a 10 marla plot in Phase 7. Two-side open, park facing, with " +
      "a covered car porch and a small lawn. Walking distance to the market.",
    price: 21500000, possession: "ready-to-move",
    areaValue: 10, areaUnit: "MARLA", areaBasis: "PLOT",
    bedrooms: 4, bathrooms: 4, totalFloors: 2, facing: "east",
    furnishing: "semi-furnished", yearBuilt: 2016,
    features: ["Corner Plot", "Park Facing", "Car Porch", "Modular Kitchen"],
    hue: 152,
  },
  {
    citySlug: "mohali", localitySlug: "sector-70", propertyType: "flat",
    title: "3 BHK flat with lift and covered parking",
    description:
      "Third-floor 3 BHK in a well-maintained society in Sector 70. Lift, power backup, covered " +
      "parking and a gated entrance. Society maintenance is on the lower side for the area.",
    price: 9800000, possession: "ready-to-move",
    areaValue: 1650, areaUnit: "SQ_FT", areaBasis: "BUILT_UP",
    bedrooms: 3, bathrooms: 3, floorNumber: 3, totalFloors: 5, facing: "north-east",
    furnishing: "unfurnished", yearBuilt: 2019, maintenance: 2800,
    features: ["Lift", "Power Backup", "Covered Parking", "Gated Society"],
    hue: 205,
  },
  {
    citySlug: "chandigarh", localitySlug: "sector-9", propertyType: "kothi",
    title: "1 kanal kothi in a prime northern sector",
    description:
      "Independent 1 kanal kothi in Sector 9. Wide frontage on a 40 ft road, mature garden, " +
      "servant quarter and parking for three cars. Original construction, well maintained.",
    price: 42000000, possession: "ready-to-move",
    areaValue: 1, areaUnit: "KANAL", areaBasis: "PLOT",
    bedrooms: 5, bathrooms: 5, totalFloors: 2, facing: "north",
    furnishing: "unfurnished", yearBuilt: 1998,
    features: ["Wide Frontage", "Servant Quarter", "Garden", "40ft Road"],
    hue: 28,
  },
  {
    citySlug: "chandigarh", localitySlug: "sector-35", propertyType: "builder-floor",
    title: "2 BHK builder floor, ground floor with parking",
    description:
      "Ground-floor builder floor in Sector 35 with independent entry and dedicated parking. " +
      "Close to the market and well connected. Suited to a small family or a working couple.",
    price: 8200000, possession: "ready-to-move",
    areaValue: 1100, areaUnit: "SQ_FT", areaBasis: "BUILT_UP",
    bedrooms: 2, bathrooms: 2, floorNumber: 0, totalFloors: 3, facing: "west",
    furnishing: "semi-furnished", yearBuilt: 2012,
    features: ["Independent Entry", "Dedicated Parking", "Near Market"],
    hue: 265,
  },
  {
    citySlug: "kharar", localitySlug: "sunny-enclave", propertyType: "plot",
    title: "150 gaj residential plot, ready to construct",
    description:
      "Clear-title residential plot in a developed pocket of Sunny Enclave. Roads, water and " +
      "electricity already in. Suitable for immediate construction.",
    price: 4200000, possession: "ready-to-move",
    areaValue: 150, areaUnit: "SQ_YD", areaBasis: "PLOT",
    facing: "south-east",
    features: ["Clear Title", "Developed Sector", "Ready to Construct"],
    hue: 96,
  },
  {
    citySlug: "kharar", localitySlug: "sunny-enclave", propertyType: "flat",
    title: "2 BHK flat, under construction, possession 2028",
    description:
      "Two-bedroom flat in an under-construction project in Sunny Enclave. Carpet area is the " +
      "RERA basis for the sale and is quoted below. Booking amount payable on agreement.",
    price: 4800000, possession: "under-construction",
    areaValue: 780, areaUnit: "SQ_FT", areaBasis: "CARPET",
    bedrooms: 2, bathrooms: 2, floorNumber: 6, totalFloors: 12, facing: "east",
    furnishing: "unfurnished", maintenance: 1800,
    features: ["Lift", "Power Backup", "Under Construction"],
    hue: 340,
  },
  {
    citySlug: "zirakpur", localitySlug: "vip-road", propertyType: "flat",
    title: "3 BHK on VIP Road with a balcony view",
    description:
      "Well-lit 3 BHK on VIP Road, seventh floor, with a large balcony. Quick access to the " +
      "airport road and the highway. Society has a gym and a small clubhouse.",
    price: 7500000, possession: "ready-to-move",
    areaValue: 1450, areaUnit: "SQ_FT", areaBasis: "BUILT_UP",
    bedrooms: 3, bathrooms: 2, floorNumber: 7, totalFloors: 14, facing: "south",
    furnishing: "semi-furnished", yearBuilt: 2021, maintenance: 3200,
    features: ["Balcony", "Gym", "Clubhouse", "Near Airport Road"],
    hue: 190,
  },
  {
    citySlug: "mohali", localitySlug: "phase-11", propertyType: "sco",
    title: "SCO on a main road, ground plus two",
    description:
      "Shop-cum-office on a main road in Phase 11. Ground floor plus two, currently vacant. " +
      "Good frontage and steady footfall from the surrounding sectors.",
    price: 31000000, transactionType: "sale", possession: "ready-to-move",
    areaValue: 6, areaUnit: "MARLA", areaBasis: "PLOT",
    totalFloors: 3, facing: "north",
    features: ["Main Road", "Corner", "High Footfall"],
    hue: 42,
  },
  {
    citySlug: "new-chandigarh", localitySlug: "eco-city", propertyType: "villa",
    title: "4 BHK villa, new launch, possession 2029",
    description:
      "Independent villa in a new-launch phase at Eco City, New Chandigarh, backing onto green " +
      "belt. " +
      "Carpet area quoted as the RERA basis. Construction-linked payment plan.",
    price: 28500000, possession: "new-launch",
    areaValue: 2400, areaUnit: "SQ_FT", areaBasis: "CARPET",
    bedrooms: 4, bathrooms: 4, totalFloors: 2, facing: "north-west",
    furnishing: "unfurnished",
    features: ["Green Belt Facing", "New Launch", "Gated Community"],
    hue: 130,
  },
  {
    citySlug: "mohali", localitySlug: "sector-82", propertyType: "kothi",
    title: "3 BHK kothi, under offer",
    description:
      "Independent house on 8 marla in Sector 82. Currently under offer — shown here so the " +
      "status badge and the buyer-facing 'under offer' state have something to display.",
    price: 15500000, possession: "ready-to-move",
    areaValue: 8, areaUnit: "MARLA", areaBasis: "PLOT",
    bedrooms: 3, bathrooms: 3, totalFloors: 2, facing: "west", yearBuilt: 2014,
    features: ["Car Porch", "Near School"],
    status: "under-offer",
    hue: 15,
  },
];

const BASE = process.env.DEMO_API_URL ?? "http://localhost:3001/api";

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${BASE}/auth/staff/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(
      `Staff login failed (${response.status}). Is the API running, and are the credentials right?`,
    );
  }
  return ((await response.json()) as { accessToken: string }).accessToken;
}

async function clean(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    // Matched on the [SAMPLE] title prefix so this can never remove real inventory, even if
    // somebody runs it against a database that has some.
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM listing WHERE title LIKE '[SAMPLE]%'
    `;

    if (rows.length === 0) {
      console.log("No sample listings found.");
      return;
    }

    const ids = rows.map((r) => r.id);
    // Media and price history cascade from listing; properties are left alone because they are
    // shared physical records and may be referenced by something real.
    await sql`DELETE FROM listing WHERE id = ANY(${ids}::uuid[])`;
    console.log(`Removed ${ids.length} sample listing(s).`);
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  loadEnvFile();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  if (process.argv.includes("--clean")) {
    await clean(connectionString);
    return;
  }

  const email = process.env.DEMO_EMAIL ?? "owner@tricityestate.test";
  const password = process.env.DEMO_PASSWORD ?? "dev-owner-password-123";

  console.log(`Signing in as ${email}…`);
  const token = await login(email, password);

  const authed = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  /*
   * ⚠️ Registrations are ensured FIRST. The publication gate refuses to make a listing ACTIVE
   * without a valid RERA number for that listing's jurisdiction, and this seed spans Punjab
   * (Mohali/Kharar/Zirakpur/New Chandigarh) and Chandigarh — two separate authorities. Without
   * both, half of these would silently fall back to drafts.
   */
  for (const [state, authority] of [
    ["Punjab", "Punjab Real Estate Regulatory Authority"],
    ["Chandigarh", "Real Estate Regulatory Authority, UT Chandigarh"],
  ] as const) {
    const response = await fetch(`${BASE}/staff/rera/${state}`, {
      method: "PUT",
      headers: authed,
      body: JSON.stringify({
        registrationNo: `${state.slice(0, 3).toUpperCase()}RERA-SAMPLE-0001`,
        authorityName: authority,
      }),
    });
    if (!response.ok) console.warn(`  could not set ${state} registration (${response.status})`);
  }
  console.log("RERA registrations ensured for Punjab and Chandigarh (SAMPLE numbers).");

  let created = 0;

  for (const listing of LISTINGS) {
    const sqft = Math.round(listing.areaValue * SQ_FT_PER_UNIT[listing.areaUnit]! * 100) / 100;

    const payload: Record<string, unknown> = {
      citySlug: listing.citySlug,
      localitySlug: listing.localitySlug,
      // Coordinates are jittered around the locality so the map has spread rather than a single
      // stack of pins. They are not real addresses.
      lat: 30.65 + Math.random() * 0.18,
      lng: 76.65 + Math.random() * 0.2,
      propertyType: listing.propertyType,
      transactionType: listing.transactionType ?? "sale",
      status: listing.status ?? "active",
      visibility: "PUBLIC",
      possession: listing.possession,
      price: listing.price,
      title: `[SAMPLE] ${listing.title}`,
      description: `${listing.description}\n\nSAMPLE LISTING — not real inventory.`,
      plotNumber: `sample-${randomUUID().slice(0, 8)}`,
      pincode: "160055",
      features: listing.features,
      areaInputValue: listing.areaValue,
      areaInputUnit: listing.areaUnit,
      areaConversionFactor: SQ_FT_PER_UNIT[listing.areaUnit],
      areaInputBasis: listing.areaBasis,
      ...(listing.areaBasis === "PLOT" ? { plotAreaSqft: sqft } : {}),
      ...(listing.areaBasis === "BUILT_UP" ? { builtUpAreaSqft: sqft } : {}),
      ...(listing.areaBasis === "CARPET" ? { carpetAreaSqft: sqft } : {}),
      ...(listing.bedrooms ? { bedrooms: listing.bedrooms } : {}),
      ...(listing.bathrooms ? { bathrooms: listing.bathrooms } : {}),
      ...(listing.floorNumber !== undefined ? { floorNumber: listing.floorNumber } : {}),
      ...(listing.totalFloors ? { totalFloors: listing.totalFloors } : {}),
      ...(listing.facing ? { facing: listing.facing } : {}),
      ...(listing.furnishing ? { furnishing: listing.furnishing } : {}),
      ...(listing.yearBuilt ? { yearBuilt: listing.yearBuilt } : {}),
      ...(listing.maintenance ? { maintenanceCharges: listing.maintenance } : {}),
    };

    const response = await fetch(`${BASE}/staff/listings`, {
      method: "POST",
      headers: authed,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(`  ✖ ${listing.title}: ${response.status} ${await response.text()}`);
      continue;
    }

    const { id } = (await response.json()) as { id: string };

    // Three photos each, so the gallery, the thumbnail strip and the hero-reorder controls all
    // have something to work with.
    const localityLabel = listing.localitySlug.replace(/-/g, " ");
    for (let index = 0; index < 3; index++) {
      const photo = await generatePhoto(
        localityLabel.toUpperCase(),
        ["Exterior", "Living area", "Plan"][index]!,
        (listing.hue + index * 14) % 360,
      );

      const form = new FormData();
      // `new Uint8Array(photo)` rather than the Buffer directly: TS types Buffer's backing store
      // as ArrayBufferLike (which admits SharedArrayBuffer) and BlobPart will not accept that.
      form.append(
        "file",
        new Blob([new Uint8Array(photo)], { type: "image/jpeg" }),
        `sample-${index}.jpg`,
      );
      form.append("caption", `${listing.title} — ${["exterior", "living area", "plan"][index]}`);

      const upload = await fetch(`${BASE}/staff/listings/${id}/media`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      if (!upload.ok) console.warn(`    photo ${index} failed: ${upload.status}`);
    }

    created++;
    console.log(`  ✔ ${listing.title}`);
  }

  console.log(`\nCreated ${created} sample listing(s) with photos.`);
  console.log("View at http://localhost:3000 with LISTING_PROVIDER=api API_URL=http://localhost:3001/api");
  console.log("Remove with: npm run db:demo -- --clean\n");
  console.log("⚠️  SAMPLE DATA. Prices are plausible, not researched. Never expose this publicly.");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("\nDemo seed failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
