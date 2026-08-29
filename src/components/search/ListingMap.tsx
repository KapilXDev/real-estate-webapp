"use client";

import {
  LngLatBounds,
  MapLibreMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
  type MapMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { site } from "@/config/site";
import { formatPriceCompact } from "@/lib/format";
import type { Listing, Polygon } from "@/lib/listings/types";

import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Map view with draw-your-own-search-area.
 *
 * WHY POLYGON DRAW IS WORTH THE COMPLEXITY: it expresses intent no dropdown filter can —
 * "this side of the highway", "walking distance to the school, but not past the arterial road".
 * It's the single feature buyers most consistently praise on Redfin, and its absence is the most
 * obvious gap on a typical agent site.
 *
 * Tiles come from OpenStreetMap raster, which needs no API key or account. For production,
 * consider a vector tile provider (MapTiler, Protomaps) for sharper labels and lower bandwidth —
 * swap `TILE_STYLE` and nothing else changes.
 *
 * Drawn polygons are written to the URL, so a drawn search is shareable and survives reload
 * like every other filter.
 */

const TILE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const DRAW_SOURCE = "draw-polygon";
const DRAW_FILL = "draw-polygon-fill";
const DRAW_LINE = "draw-polygon-line";

export function ListingMap({
  listings,
  polygons,
}: {
  listings: Listing[];
  polygons: Polygon[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);

  const router = useRouter();
  const searchParams = useSearchParams();

  const [isDrawing, setIsDrawing] = useState(false);
  /** Vertices of the in-progress polygon. Ref because map handlers close over it. */
  const draftPoints = useRef<Polygon>([]);
  const [draftCount, setDraftCount] = useState(0);

  /* ---- Map initialisation. Runs once; listings update via a separate effect. ---- */
  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new MapLibreMap({
      container: container.current,
      style: TILE_STYLE,
      center: [site.market.center.lng, site.market.center.lat],
      zoom: site.market.defaultZoom,
      attributionControl: { compact: true },
    });

    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");

    instance.on("load", () => {
      instance.addSource(DRAW_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      instance.addLayer({
        id: DRAW_FILL,
        type: "fill",
        source: DRAW_SOURCE,
        paint: { "fill-color": "#33614c", "fill-opacity": 0.12 },
      });
      instance.addLayer({
        id: DRAW_LINE,
        type: "line",
        source: DRAW_SOURCE,
        paint: { "line-color": "#33614c", "line-width": 2.5, "line-dasharray": [2, 1] },
      });
    });

    map.current = instance;

    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  /* ---- Render the committed + in-progress polygons. ---- */
  const renderPolygons = useCallback(
    (committed: Polygon[], draft: Polygon) => {
      const instance = map.current;
      const source = instance?.getSource(DRAW_SOURCE) as GeoJSONSource | undefined;
      if (!source) return;

      const rings = [...committed];
      // Show the draft as soon as it has a segment, so drawing has live feedback.
      if (draft.length >= 2) rings.push(draft);

      source.setData({
        type: "FeatureCollection",
        features: rings.map((ring) => ({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            // GeoJSON is [lng, lat] and rings must be explicitly closed.
            coordinates: [[...ring, ring[0]].map((p) => [p.lng, p.lat])],
          },
        })),
      });
    },
    [],
  );

  /* ---- Commit a drawn polygon to the URL, which re-runs the search server-side. ---- */
  const commitPolygon = useCallback(
    (ring: Polygon) => {
      if (ring.length < 3) return;

      const params = new URLSearchParams(searchParams.toString());
      const encoded = ring.map((p) => `${p.lat.toFixed(5)} ${p.lng.toFixed(5)}`).join(" ");
      const existing = params.get("poly");
      // Append rather than replace — multiple areas union together, matching how buyers think.
      params.set("poly", existing ? `${existing}|${encoded}` : encoded);
      params.delete("page");

      router.push(`/search?${params.toString()}`);
    },
    [router, searchParams],
  );

  const finishDrawing = useCallback(() => {
    const ring = draftPoints.current;
    draftPoints.current = [];
    setDraftCount(0);
    setIsDrawing(false);
    if (ring.length >= 3) commitPolygon(ring);
  }, [commitPolygon]);

  /* ---- Drawing interaction. Bound only while drawing is active. ---- */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !isDrawing) return;

    const onClick = (e: MapMouseEvent) => {
      draftPoints.current = [
        ...draftPoints.current,
        { lat: e.lngLat.lat, lng: e.lngLat.lng },
      ];
      setDraftCount(draftPoints.current.length);
      renderPolygons(polygons, draftPoints.current);
    };

    // Double-click closes the shape — the convention users already know from other map tools.
    const onDoubleClick = (e: MapMouseEvent) => {
      e.preventDefault();
      finishDrawing();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        draftPoints.current = [];
        setDraftCount(0);
        setIsDrawing(false);
        renderPolygons(polygons, []);
      }
      if (e.key === "Enter") finishDrawing();
    };

    instance.on("click", onClick);
    instance.on("dblclick", onDoubleClick);
    window.addEventListener("keydown", onKey);

    // Suppress zoom-on-double-click so closing the shape doesn't also zoom.
    instance.doubleClickZoom.disable();
    instance.getCanvas().style.cursor = "crosshair";

    return () => {
      instance.off("click", onClick);
      instance.off("dblclick", onDoubleClick);
      window.removeEventListener("keydown", onKey);
      instance.doubleClickZoom.enable();
      instance.getCanvas().style.cursor = "";
    };
  }, [isDrawing, polygons, renderPolygons, finishDrawing]);

  /* ---- Keep committed polygons rendered when they change via the URL. ---- */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const draw = () => renderPolygons(polygons, draftPoints.current);
    if (instance.isStyleLoaded()) draw();
    else instance.once("load", draw);
  }, [polygons, renderPolygons]);

  /* ---- Price-pill markers. Rebuilt whenever results change. ---- */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    markers.current.forEach((marker) => marker.remove());
    markers.current = [];

    listings.forEach((listing) => {
      const el = document.createElement("a");
      el.href = `/listings/${listing.listingKey}`;
      el.textContent = formatPriceCompact(listing.listPrice);
      el.className =
        "block rounded-full border border-white bg-brand-800 px-2.5 py-1 text-xs font-semibold text-white shadow-md transition-transform hover:scale-110 hover:bg-clay-600";
      el.setAttribute(
        "aria-label",
        `${listing.address.unparsed}, ${formatPriceCompact(listing.listPrice)}`,
      );

      markers.current.push(
        new Marker({ element: el })
          .setLngLat([listing.coordinates.lng, listing.coordinates.lat])
          .addTo(instance),
      );
    });

    // Frame the results, but only when the user isn't mid-draw — refitting would yank the map.
    if (listings.length > 0 && !isDrawing) {
      const bounds = listings.reduce(
        (acc, l) => acc.extend([l.coordinates.lng, l.coordinates.lat]),
        new LngLatBounds(
          [listings[0].coordinates.lng, listings[0].coordinates.lat],
          [listings[0].coordinates.lng, listings[0].coordinates.lat],
        ),
      );
      instance.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 400 });
    }
  }, [listings, isDrawing]);

  const clearAreas = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("poly");
    params.delete("page");
    router.push(`/search?${params.toString()}`);
  };

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />

      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2">
        <div className="pointer-events-auto flex gap-2">
          {!isDrawing ? (
            <button
              type="button"
              onClick={() => setIsDrawing(true)}
              className="rounded-md bg-white px-3.5 py-2 text-sm font-semibold text-sand-900 shadow-md hover:bg-sand-50"
            >
              ✏️ Draw area
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={finishDrawing}
                disabled={draftCount < 3}
                className="rounded-md bg-brand-700 px-3.5 py-2 text-sm font-semibold text-white shadow-md disabled:opacity-50"
              >
                Done ({draftCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  draftPoints.current = [];
                  setDraftCount(0);
                  setIsDrawing(false);
                  renderPolygons(polygons, []);
                }}
                className="rounded-md bg-white px-3.5 py-2 text-sm font-medium text-sand-800 shadow-md"
              >
                Cancel
              </button>
            </>
          )}

          {polygons.length > 0 && !isDrawing && (
            <button
              type="button"
              onClick={clearAreas}
              className="rounded-md bg-white px-3.5 py-2 text-sm font-medium text-sand-800 shadow-md hover:bg-sand-50"
            >
              Clear {polygons.length} area{polygons.length > 1 ? "s" : ""}
            </button>
          )}
        </div>

        {isDrawing && (
          <p className="pointer-events-auto max-w-xs rounded-md bg-sand-950/85 px-3 py-2 text-xs leading-relaxed text-white">
            Click to place points around the area you want. Double-click or press Enter to
            finish, Escape to cancel.
          </p>
        )}
      </div>
    </div>
  );
}
