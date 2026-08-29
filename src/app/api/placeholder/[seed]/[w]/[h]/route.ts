/**
 * Deterministic SVG placeholder images for sample listings.
 *
 * WHY LOCAL: an external placeholder service (picsum, unsplash) would make the site depend on the
 * network to render, slow down every page, and eventually rot when the service changes. These are
 * generated in-process, cached hard, and vary by seed so a listing's gallery doesn't look like the
 * same image six times.
 *
 * These disappear entirely once the MLS feed supplies real photos — nothing else depends on them.
 */

import { NextResponse } from "next/server";

/** Same hash as the mock provider, so a listing key maps to a stable image. */
function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Muted, warm palettes that sit alongside the site's sand/green theme rather than fighting it. */
const PALETTES = [
  { sky: ["#dfe7ea", "#c3d2d8"], ground: "#b9bfae", structure: "#8d7f6d", roof: "#5c5147" },
  { sky: ["#ece4d9", "#d8c9b6"], ground: "#a8ad93", structure: "#9a8873", roof: "#6b5a4a" },
  { sky: ["#dde6e3", "#bccfc8"], ground: "#aebba4", structure: "#84796a", roof: "#4f4740" },
  { sky: ["#f0e8e0", "#dbccc0"], ground: "#b4b49c", structure: "#a08d78", roof: "#70604e" },
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ seed: string; w: string; h: string }> },
) {
  const { seed, w, h } = await params;

  // Clamp dimensions — an unbounded value here would be a trivial resource-exhaustion vector.
  const width = Math.min(2400, Math.max(16, parseInt(w, 10) || 1200));
  const height = Math.min(2400, Math.max(16, parseInt(h, 10) || 800));

  const rng = makeRng(hashSeed(seed));
  const palette = PALETTES[Math.floor(rng() * PALETTES.length)];

  const horizon = height * (0.62 + rng() * 0.1);
  const houseWidth = width * (0.3 + rng() * 0.16);
  const houseHeight = height * (0.26 + rng() * 0.12);
  const houseX = width * (0.2 + rng() * 0.3);
  const houseY = horizon - houseHeight;
  const roofPeak = houseY - height * (0.1 + rng() * 0.07);

  // Windows arranged on a simple grid, count varying by seed.
  const cols = 2 + Math.floor(rng() * 2);
  const rows = 1 + Math.floor(rng() * 2);
  const windowW = (houseWidth / cols) * 0.42;
  const windowH = (houseHeight / rows) * 0.34;
  const windows: string[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const wx = houseX + (houseWidth / cols) * (c + 0.5) - windowW / 2;
      const wy = houseY + (houseHeight / rows) * (r + 0.5) - windowH / 2;
      windows.push(
        `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${windowW.toFixed(1)}" height="${windowH.toFixed(1)}" rx="2" fill="#f3efe6" opacity="0.82"/>`,
      );
    }
  }

  // A few trees for depth, always behind the structure.
  const trees = Array.from({ length: 2 + Math.floor(rng() * 3) }, () => {
    const tx = width * rng();
    const scale = 0.5 + rng() * 0.6;
    const treeH = height * 0.16 * scale;
    return `<ellipse cx="${tx.toFixed(1)}" cy="${(horizon - treeH * 0.5).toFixed(1)}" rx="${(treeH * 0.42).toFixed(1)}" ry="${(treeH * 0.55).toFixed(1)}" fill="#8a9b77" opacity="0.5"/>`;
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Property photo placeholder">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.sky[0]}"/>
      <stop offset="100%" stop-color="${palette.sky[1]}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#sky)"/>
  ${trees}
  <rect x="0" y="${horizon.toFixed(1)}" width="${width}" height="${(height - horizon).toFixed(1)}" fill="${palette.ground}"/>
  <polygon points="${(houseX - houseWidth * 0.08).toFixed(1)},${houseY.toFixed(1)} ${(houseX + houseWidth / 2).toFixed(1)},${roofPeak.toFixed(1)} ${(houseX + houseWidth * 1.08).toFixed(1)},${houseY.toFixed(1)}" fill="${palette.roof}"/>
  <rect x="${houseX.toFixed(1)}" y="${houseY.toFixed(1)}" width="${houseWidth.toFixed(1)}" height="${houseHeight.toFixed(1)}" fill="${palette.structure}"/>
  ${windows.join("")}
</svg>`;

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      // Deterministic output — safe to cache indefinitely.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
