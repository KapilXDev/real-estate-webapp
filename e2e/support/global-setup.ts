import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { assertDevDatabase, cleanupE2EData, ensureGateOrganisation } from "./db";
import { repoRoot } from "./env";

/**
 * The photo every upload test uses.
 *
 * ⚠️ GENERATED, NOT CHECKED IN. A real JPEG is a binary blob nobody can review in a diff, and the
 * one property that matters here — that it is large enough for all three variants to be a genuine
 * DOWNSCALE — is a number, not a picture. 1600 wide means thumb (400), card (800) and hero (1600)
 * all exercise the resize path; a small fixture would hit `withoutEnlargement` and silently test
 * nothing but a copy.
 *
 * JPEG rather than PNG so the pipeline's format conversion to WebP is real work, and with EXIF
 * orientation 6 set so the rotation fix from the media service is exercised: without `.rotate()`
 * the stored pixels are landscape and only the tag says the picture is portrait.
 */
const FIXTURE = "listing-photo.jpg";

async function writeFixtureImage(): Promise<void> {
  const dir = path.join(repoRoot(), "e2e", "fixtures");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, FIXTURE);
  if (existsSync(file)) return;

  await sharp({
    create: {
      width: 1600,
      height: 1200,
      channels: 3,
      // A flat colour field, not stock imagery: no network dependency and no licensing question,
      // which is the same reasoning the demo seed uses.
      background: { r: 32, g: 84, b: 72 },
    },
  })
    .withExifMerge({ IFD0: { Orientation: "6" } })
    .jpeg({ quality: 88 })
    .toFile(file);
}

export default async function globalSetup(): Promise<void> {
  assertDevDatabase();

  /*
   * ⚠️ Clean BEFORE the run, not only after it. A cancelled run (Ctrl-C, a crashed worker, a
   * failed assertion that skipped teardown) leaves marked rows behind, and the next run then
   * finds two listings matching its search. That fails as an ambiguous-selector error pointing at
   * the test rather than at the leftover, and it is the single most confusing way for a suite to
   * break.
   */
  const removed = await cleanupE2EData();
  const stale = Object.values(removed).reduce((a, b) => a + b, 0);
  if (stale > 0) {
    console.log(
      `[e2e] cleared ${stale} row(s) left by a previous run ` +
        `(${removed.listings} listings, ${removed.leads} leads, ` +
        `${removed.contacts} contacts, ${removed.reraRegistrations} RERA)`,
    );
  }

  /* The second tenant the RERA gate test signs in as — see the long note on E2E_ORG. Created
   * once and left in place; recreating it per run would cost an argon2 hash and a subprocess for
   * nothing. */
  const { created } = await ensureGateOrganisation();
  if (created) console.log("[e2e] created the gate-test organisation");

  await writeFixtureImage();
}

export function fixturePath(name: string = FIXTURE): string {
  return path.join(repoRoot(), "e2e", "fixtures", name);
}
