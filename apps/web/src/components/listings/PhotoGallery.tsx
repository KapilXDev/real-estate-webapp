"use client";

import { useCallback, useEffect, useState } from "react";

import type { ListingMedia } from "@/lib/listings/types";

import { ListingImage } from "./ListingImage";

/**
 * Listing photo gallery with a lightbox.
 *
 * Photos are the single most-engaged element on a listing page, so this gets real treatment:
 * a hero + thumbnail mosaic, full-screen lightbox, and keyboard navigation (arrows to move,
 * Escape to close) because power users flick through dozens of listings a session.
 */
export function PhotoGallery({ media }: { media: ListingMedia[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const close = useCallback(() => setLightboxIndex(null), []);

  const step = useCallback(
    (delta: number) =>
      setLightboxIndex((current) =>
        current === null ? null : (current + delta + media.length) % media.length,
      ),
    [media.length],
  );

  useEffect(() => {
    if (lightboxIndex === null) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);

    // Lock background scroll while the lightbox owns the viewport.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [lightboxIndex, close, step]);

  if (media.length === 0) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center rounded-card bg-sand-100 text-sand-500">
        No photos available
      </div>
    );
  }

  const [hero, ...rest] = media;
  const thumbnails = rest.slice(0, 4);

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-4 sm:grid-rows-2">
        <button
          type="button"
          onClick={() => setLightboxIndex(0)}
          className="relative aspect-[4/3] overflow-hidden rounded-card sm:col-span-2 sm:row-span-2 sm:aspect-auto"
        >
          <ListingImage
            media={hero}
            alt={hero.caption}
            sizes="(max-width: 640px) 100vw, 50vw"
            priority
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
          />
        </button>

        {thumbnails.map((photo, index) => (
          <button
            key={photo.url}
            type="button"
            onClick={() => setLightboxIndex(index + 1)}
            className="relative hidden aspect-[4/3] overflow-hidden rounded-card sm:block"
          >
            <ListingImage
              media={photo}
              alt={photo.caption}
              sizes="25vw"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
            />
            {/* "+N more" overlay on the final thumbnail when photos are hidden. */}
            {index === thumbnails.length - 1 && media.length > 5 && (
              <span className="absolute inset-0 flex items-center justify-center bg-sand-950/55 text-sm font-semibold text-white">
                +{media.length - 5} more
              </span>
            )}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setLightboxIndex(0)}
        className="mt-3 rounded-md border border-sand-300 bg-white px-4 py-2 text-sm font-medium text-sand-800 hover:border-sand-400"
      >
        View all {media.length} photos
      </button>

      {lightboxIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo gallery"
          className="fixed inset-0 z-[100] flex flex-col bg-sand-950/95"
          onClick={close}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="text-sm tabular-nums">
              {lightboxIndex + 1} / {media.length}
            </span>
            <button
              type="button"
              onClick={close}
              className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-white/10"
            >
              Close
            </button>
          </div>

          {/* stopPropagation so clicking the image itself doesn't dismiss the lightbox. */}
          <div
            className="relative flex-1"
            onClick={(e) => e.stopPropagation()}
          >
            <ListingImage
              media={media[lightboxIndex]}
              alt={media[lightboxIndex].caption}
              sizes="100vw"
              priority
              className="absolute inset-0 h-full w-full object-contain"
            />
          </div>

          <div
            className="flex items-center justify-between gap-4 px-4 py-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => step(-1)}
              className="rounded-md bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/20"
            >
              ← Previous
            </button>
            <p className="hidden flex-1 text-center text-sm text-white/70 sm:block">
              {media[lightboxIndex].caption}
            </p>
            <button
              type="button"
              onClick={() => step(1)}
              className="rounded-md bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/20"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
