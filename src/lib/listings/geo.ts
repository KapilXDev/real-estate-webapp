/**
 * Geometry helpers for map-based search.
 *
 * Kept provider-agnostic: the mock provider filters with these in memory, and the future
 * RESO provider uses them to validate or post-filter server-side spatial results.
 */

import type { Polygon } from "./types";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Ray-casting point-in-polygon test.
 *
 * Casts a ray east from the point and counts edge crossings — odd means inside. Treats
 * coordinates as planar, which is accurate enough at neighborhood scale (a few km) where the
 * curvature error is far below the precision of a hand-drawn polygon.
 */
export function pointInPolygon(point: LatLng, polygon: Polygon): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    // Does the edge straddle the point's latitude, and is the crossing to the east?
    const straddles = yi > point.lat !== yj > point.lat;
    if (straddles) {
      const intersectLng = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
      if (point.lng < intersectLng) inside = !inside;
    }
  }
  return inside;
}

/**
 * True when the point falls inside ANY of the polygons.
 *
 * Union rather than intersection is deliberate — it matches how buyers think when they draw
 * several areas ("this neighborhood OR that one"), and mirrors Zillow's multi-area search.
 */
export function pointInAnyPolygon(point: LatLng, polygons: Polygon[]): boolean {
  if (polygons.length === 0) return true;
  return polygons.some((p) => pointInPolygon(point, p));
}

/** True when the point is inside the viewport bounds. Handles the antimeridian case. */
export function pointInBounds(point: LatLng, bounds: Bounds): boolean {
  const withinLat = point.lat <= bounds.north && point.lat >= bounds.south;
  if (!withinLat) return false;

  // A viewport crossing the antimeridian has west > east.
  const crossesAntimeridian = bounds.west > bounds.east;
  return crossesAntimeridian
    ? point.lng >= bounds.west || point.lng <= bounds.east
    : point.lng >= bounds.west && point.lng <= bounds.east;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Smallest bounds containing every point. Returns null for an empty list. */
export function boundsOf(points: LatLng[]): Bounds | null {
  if (points.length === 0) return null;

  return points.reduce<Bounds>(
    (acc, p) => ({
      north: Math.max(acc.north, p.lat),
      south: Math.min(acc.south, p.lat),
      east: Math.max(acc.east, p.lng),
      west: Math.min(acc.west, p.lng),
    }),
    {
      north: points[0].lat,
      south: points[0].lat,
      east: points[0].lng,
      west: points[0].lng,
    },
  );
}

/** Expand bounds by a margin so markers near the edge aren't clipped by the viewport. */
export function padBounds(bounds: Bounds, factor = 0.1): Bounds {
  const latPad = (bounds.north - bounds.south) * factor || 0.01;
  const lngPad = (bounds.east - bounds.west) * factor || 0.01;
  return {
    north: bounds.north + latPad,
    south: bounds.south - latPad,
    east: bounds.east + lngPad,
    west: bounds.west - lngPad,
  };
}
