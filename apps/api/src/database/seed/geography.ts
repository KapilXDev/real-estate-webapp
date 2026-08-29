/**
 * Tricity geography seed — Chandigarh, Mohali, Kharar and neighbours.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *  ⚠️  READ THIS BEFORE TRUSTING ANY COORDINATE IN THIS FILE
 *
 *  CITY centroids are real and reliable.
 *
 *  LOCALITY (sector/phase) centroids are GENERATED from a grid model, NOT surveyed. The
 *  Chandigarh sector grid is modelled as evenly spaced rows, which is approximately true of
 *  Le Corbusier's plan but is NOT accurate per sector. Row ordering in particular is an
 *  assumption.
 *
 *  Consequences, stated plainly:
 *   - Good enough to develop and demo against.
 *   - NOT good enough to ship. Draw-your-own-area search accuracy depends directly on these,
 *     and a buyer drawing a box around Sector 35 must actually get Sector 35 listings.
 *   - Every generated row is written with `is_approximate = true` and
 *     `boundary_source = 'GENERATED_RADIUS'`, so the replacement job can find them with a
 *     single WHERE clause and nothing silently passes for survey data.
 *
 *  TO REPLACE WITH REAL BOUNDARIES (do this before launch) — OpenStreetMap has the tricity
 *  sector polygons. Run against https://overpass-turbo.eu:
 *
 *      [out:json][timeout:60];
 *      area["name"="Chandigarh"]["admin_level"="4"]->.a;
 *      (
 *        relation(area.a)["place"="suburb"];
 *        way(area.a)["place"="suburb"];
 *      );
 *      out geom;
 *
 *  then import as GeoJSON into `locality.boundary` and set
 *  `is_approximate = false, boundary_source = 'OSM'`.
 * ══════════════════════════════════════════════════════════════════════════════════════════
 */

export interface CitySeed {
  name: string;
  state: string;
  slug: string;
  lat: number;
  lng: number;
}

export interface LocalitySeed {
  citySlug: string;
  name: string;
  slug: string;
  kind: "SECTOR" | "PHASE" | "ENCLAVE" | "COLONY" | "VILLAGE" | "ROAD_BELT";
  lat: number;
  lng: number;
  /** Circle radius used to synthesise a boundary polygon, in metres. */
  radiusM: number;
  parentSlug?: string;
}

/** Real coordinates. These are the anchors everything else is generated from. */
export const CITIES: CitySeed[] = [
  { name: "Chandigarh", state: "Chandigarh", slug: "chandigarh", lat: 30.7333, lng: 76.7794 },
  { name: "Mohali", state: "Punjab", slug: "mohali", lat: 30.7046, lng: 76.7179 },
  { name: "Kharar", state: "Punjab", slug: "kharar", lat: 30.7463, lng: 76.6469 },
  { name: "Zirakpur", state: "Punjab", slug: "zirakpur", lat: 30.6425, lng: 76.8173 },
  { name: "New Chandigarh", state: "Punjab", slug: "new-chandigarh", lat: 30.7897, lng: 76.7181 },
  { name: "Panchkula", state: "Haryana", slug: "panchkula", lat: 30.6942, lng: 76.8606 },
];

/* ------------------------------------------------------------------------------------- */
/* Grid generation                                                                        */
/* ------------------------------------------------------------------------------------- */

const METRES_PER_DEG_LAT = 111_320;
const metresPerDegLng = (lat: number) =>
  METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/**
 * Offset a point by metres. Planar approximation — error is negligible at the few-kilometre
 * scale we use it for.
 */
function offset(lat: number, lng: number, northM: number, eastM: number) {
  return {
    lat: lat + northM / METRES_PER_DEG_LAT,
    lng: lng + eastM / metresPerDegLng(lat),
  };
}

/**
 * Chandigarh's sectors.
 *
 * Sector dimensions are roughly 1200m x 800m in Le Corbusier's plan, laid out in rows of six.
 * The grid is rotated relative to true north; ROTATION_DEG below is an estimate.
 *
 * ⚠️ SECTOR 13 DOES NOT EXIST. It was deliberately omitted from the original plan, and
 *    hardcoding 1..56 without excluding it produces a locality that no buyer will ever search
 *    for and that will look like a data-quality bug the first time anyone notices.
 */
const CHANDIGARH_SECTOR_WIDTH_M = 1200;
const CHANDIGARH_SECTOR_HEIGHT_M = 800;
const CHANDIGARH_SECTORS_PER_ROW = 6;
const CHANDIGARH_ROTATION_DEG = 25;

/** Anchor: approximately Sector 1 (Capitol Complex), in the city's north-east. */
const CHANDIGARH_ANCHOR = { lat: 30.7590, lng: 76.8095 };

function rotate(northM: number, eastM: number, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  return {
    northM: northM * Math.cos(rad) - eastM * Math.sin(rad),
    eastM: northM * Math.sin(rad) + eastM * Math.cos(rad),
  };
}

function generateChandigarhSectors(): LocalitySeed[] {
  const sectors: LocalitySeed[] = [];

  // 1..56, skipping 13.
  const numbers = Array.from({ length: 56 }, (_, i) => i + 1).filter((n) => n !== 13);

  numbers.forEach((number, index) => {
    const row = Math.floor(index / CHANDIGARH_SECTORS_PER_ROW);
    const col = index % CHANDIGARH_SECTORS_PER_ROW;

    // Rows march south-west; columns march west from the anchor.
    const raw = {
      northM: -row * CHANDIGARH_SECTOR_HEIGHT_M,
      eastM: -col * CHANDIGARH_SECTOR_WIDTH_M,
    };
    const rotated = rotate(raw.northM, raw.eastM, CHANDIGARH_ROTATION_DEG);
    const point = offset(
      CHANDIGARH_ANCHOR.lat,
      CHANDIGARH_ANCHOR.lng,
      rotated.northM,
      rotated.eastM,
    );

    sectors.push({
      citySlug: "chandigarh",
      name: `Sector ${number}`,
      slug: `sector-${number}`,
      kind: "SECTOR",
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      // Half the diagonal of a sector — a circle that roughly covers the rectangle.
      radiusM: 700,
    });
  });

  return sectors;
}

/**
 * Mohali (SAS Nagar).
 *
 * Two distinct naming systems coexist and buyers use both:
 *   - Phases 1-11  — the older, established part of town
 *   - Sectors 66-91 — the newer GMADA-planned expansion
 * Both must be searchable or you lose queries.
 */
function generateMohaliLocalities(): LocalitySeed[] {
  const out: LocalitySeed[] = [];
  const anchor = { lat: 30.7150, lng: 76.7250 };

  for (let phase = 1; phase <= 11; phase++) {
    const row = Math.floor((phase - 1) / 4);
    const col = (phase - 1) % 4;
    const point = offset(anchor.lat, anchor.lng, -row * 900, -col * 900);
    out.push({
      citySlug: "mohali",
      name: `Phase ${phase}`,
      slug: `phase-${phase}`,
      kind: "PHASE",
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      radiusM: 600,
    });
  }

  const sectorAnchor = { lat: 30.6900, lng: 76.7000 };
  for (let sector = 66; sector <= 91; sector++) {
    const index = sector - 66;
    const row = Math.floor(index / 5);
    const col = index % 5;
    const point = offset(sectorAnchor.lat, sectorAnchor.lng, -row * 900, -col * 900);
    out.push({
      citySlug: "mohali",
      name: `Sector ${sector}`,
      slug: `sector-${sector}`,
      kind: "SECTOR",
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      radiusM: 650,
    });
  }

  return out;
}

/**
 * Kharar. Not a planned grid — it is a set of named colonies and enclaves, largely strung
 * along the Kharar-Landran road and the Chandigarh highway. Named individually because that is
 * genuinely how inventory here is described.
 */
const KHARAR_LOCALITIES: LocalitySeed[] = [
  { citySlug: "kharar", name: "Sunny Enclave", slug: "sunny-enclave", kind: "ENCLAVE", lat: 30.7361, lng: 76.6603, radiusM: 900 },
  { citySlug: "kharar", name: "Desu Majra", slug: "desu-majra", kind: "VILLAGE", lat: 30.7290, lng: 76.6720, radiusM: 700 },
  { citySlug: "kharar", name: "Kharar-Landran Road", slug: "kharar-landran-road", kind: "ROAD_BELT", lat: 30.7250, lng: 76.6850, radiusM: 1200 },
  { citySlug: "kharar", name: "Gillco Valley", slug: "gillco-valley", kind: "ENCLAVE", lat: 30.7180, lng: 76.6620, radiusM: 800 },
  { citySlug: "kharar", name: "Shivalik City", slug: "shivalik-city", kind: "ENCLAVE", lat: 30.7420, lng: 76.6520, radiusM: 700 },
];

const ZIRAKPUR_LOCALITIES: LocalitySeed[] = [
  { citySlug: "zirakpur", name: "VIP Road", slug: "vip-road", kind: "ROAD_BELT", lat: 30.6480, lng: 76.8210, radiusM: 1000 },
  { citySlug: "zirakpur", name: "Dhakoli", slug: "dhakoli", kind: "COLONY", lat: 30.6690, lng: 76.8380, radiusM: 900 },
  { citySlug: "zirakpur", name: "Peer Muchalla", slug: "peer-muchalla", kind: "COLONY", lat: 30.6760, lng: 76.8450, radiusM: 800 },
];

const NEW_CHANDIGARH_LOCALITIES: LocalitySeed[] = [
  { citySlug: "new-chandigarh", name: "Mullanpur", slug: "mullanpur", kind: "COLONY", lat: 30.7897, lng: 76.7181, radiusM: 1200 },
  { citySlug: "new-chandigarh", name: "Eco City", slug: "eco-city", kind: "ENCLAVE", lat: 30.7960, lng: 76.7080, radiusM: 900 },
];

export const LOCALITIES: LocalitySeed[] = [
  ...generateChandigarhSectors(),
  ...generateMohaliLocalities(),
  ...KHARAR_LOCALITIES,
  ...ZIRAKPUR_LOCALITIES,
  ...NEW_CHANDIGARH_LOCALITIES,
];

/**
 * Build a GeoJSON circle approximating a locality boundary.
 *
 * A real sector is a rectangle and a real colony is an irregular blob; this is a placeholder
 * that lets spatial queries work end to end until OSM data replaces it. `segments` at 24 keeps
 * the polygon small enough to be cheap while staying visually round.
 */
export function circlePolygon(
  lat: number,
  lng: number,
  radiusM: number,
  segments = 24,
): { type: "Polygon"; coordinates: [number, number][][] } {
  const ring: [number, number][] = [];

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const point = offset(
      lat,
      lng,
      radiusM * Math.cos(angle),
      radiusM * Math.sin(angle),
    );
    ring.push([Number(point.lng.toFixed(6)), Number(point.lat.toFixed(6))]);
  }
  // GeoJSON rings must close explicitly.
  ring.push(ring[0]!);

  return { type: "Polygon", coordinates: [ring] };
}
