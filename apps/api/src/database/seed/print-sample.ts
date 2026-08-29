/** Dev utility: print a sample of generated geography for eyeballing. Not part of the app. */
import { CITIES, LOCALITIES } from "./geography";

const counts = new Map<string, number>();
for (const l of LOCALITIES) counts.set(l.citySlug, (counts.get(l.citySlug) ?? 0) + 1);

console.log(`${CITIES.length} cities, ${LOCALITIES.length} localities\n`);
for (const [city, n] of [...counts].sort()) console.log(`  ${city.padEnd(16)} ${n}`);

console.log("\nSample generated centroids (ALL APPROXIMATE):");
const samples = ["sector-1", "sector-17", "sector-35", "sector-56"];
for (const slug of samples) {
  const l = LOCALITIES.find((x) => x.citySlug === "chandigarh" && x.slug === slug);
  if (l) console.log(`  Chandigarh ${l.name.padEnd(11)} ${l.lat}, ${l.lng}`);
}
for (const slug of ["phase-1", "sector-66"]) {
  const l = LOCALITIES.find((x) => x.citySlug === "mohali" && x.slug === slug);
  if (l) console.log(`  Mohali     ${l.name.padEnd(11)} ${l.lat}, ${l.lng}`);
}
for (const l of LOCALITIES.filter((x) => x.citySlug === "kharar")) {
  console.log(`  Kharar     ${l.name.padEnd(11)} ${l.lat}, ${l.lng}  (${l.kind})`);
}
