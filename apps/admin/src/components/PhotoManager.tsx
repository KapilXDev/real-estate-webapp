"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface AdminMedia {
  id: string;
  url: string;
  caption: string;
  order: number;
  status: string;
  error: string | null;
}

/**
 * Photo upload, ordering and deletion.
 *
 * ⚠️ UPLOADS GO TO A LOCAL ROUTE HANDLER, NOT DIRECTLY TO THE API. The browser has no token — the
 * session is an httpOnly cookie — so `/api/listings/[id]/media` forwards the multipart body with
 * the access token attached server-side. This also keeps the API origin out of the browser.
 *
 * ⚠️ REORDERING IS BUTTONS, NOT DRAG-AND-DROP, on purpose. Drag-and-drop needs a dependency, is
 * fiddly on a touchscreen, and is close to unusable with a keyboard or a screen reader. Photo
 * order is set once per listing and the first photo is the hero — which is the only ordering
 * decision that really matters, so it gets its own explicit button.
 */
export function PhotoManager({
  listingId,
  initialPhotos,
}: {
  listingId: string;
  initialPhotos: AdminMedia[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState(initialPhotos);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /*
   * ⚠️ Photos save on SELECTION, not on "Save changes" — the button below belongs to the listing
   * fields and has nothing to do with these. That is not obvious from the screen, and an agent who
   * assumes otherwise will either wait for a confirmation that is not coming or navigate away
   * believing the upload was lost. Saying "added" explicitly is the cheapest way to close the gap.
   */
  const [added, setAdded] = useState(0);

  /*
   * ⚠️ RESYNC WHEN THE SERVER LIST CHANGES. `useState(initialPhotos)` reads the prop ONCE, at
   * mount — React does not reinitialise state when a prop changes. After an upload,
   * `router.refresh()` re-renders the page and hands down a new `initialPhotos`, but this
   * component keeps the array it was born with, so the grid went on saying "No photos yet"
   * while the upload had in fact returned 201.
   *
   * That is the worst possible failure for this screen: no error, no spinner, no photo. The
   * rational response is to upload again, and again — each retry storing another copy — and then
   * to conclude the tool is broken. It survived review because a hard reload shows the photos,
   * which is exactly what anyone testing by hand does.
   *
   * This is React's documented "adjusting state when a prop changes" pattern: compare against the
   * last-seen server list during render and reset. The local copy has to stay, because reordering
   * is optimistic — waiting for a round trip before the picture moves feels broken.
   *
   * The signature includes `status` so a photo that finishes processing also lands.
   */
  const serverSignature = initialPhotos.map((p) => `${p.id}:${p.status}:${p.order}`).join(",");
  const [lastServerSignature, setLastServerSignature] = useState(serverSignature);
  if (serverSignature !== lastServerSignature) {
    setLastServerSignature(serverSignature);
    setPhotos(initialPhotos);
  }

  async function upload(files: FileList) {
    setError(null);
    setAdded(0);
    setUploading(files.length);
    let succeeded = 0;

    /*
     * Sequential, not Promise.all. Each upload decodes and resizes a multi-megabyte image on the
     * API process; firing fifteen at once from a phone gallery would put the whole batch in
     * flight and risk tripping the 60/minute limit. One at a time is slower in theory and more
     * reliable in practice, and the agent sees steady progress rather than a long stall.
     */
    for (const file of Array.from(files)) {
      const body = new FormData();
      body.append("file", file);

      try {
        const response = await fetch(`/api/listings/${listingId}/media`, { method: "POST", body });
        if (!response.ok) {
          const detail = (await response.json().catch(() => ({}))) as { error?: string };
          // Name the file — with a multi-file upload, "invalid image" alone is useless.
          setError(`${file.name}: ${detail.error ?? "upload failed"}`);
        } else {
          succeeded += 1;
        }
      } catch {
        setError(`${file.name}: could not reach the server.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }

    if (inputRef.current) inputRef.current.value = "";
    setAdded(succeeded);
    router.refresh();
  }

  async function reorder(next: AdminMedia[]) {
    // Optimistic: reordering is the one action where waiting for a round trip before the picture
    // moves feels broken. A failure re-syncs from the server below.
    setPhotos(next);
    const response = await fetch(`/api/listings/${listingId}/media/order`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: next.map((p) => p.id) }),
    });
    if (!response.ok) {
      setError("Could not save the new order.");
      router.refresh();
    }
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target]!, next[index]!];
    void reorder(next);
  }

  function makeHero(index: number) {
    if (index === 0) return;
    const next = [...photos];
    const [chosen] = next.splice(index, 1);
    next.unshift(chosen!);
    void reorder(next);
  }

  async function remove(id: string) {
    const response = await fetch(`/api/listings/${listingId}/media/${id}`, { method: "DELETE" });
    if (response.ok) {
      setPhotos((current) => current.filter((p) => p.id !== id));
      router.refresh();
    } else {
      setError("Could not delete that photo.");
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-card border border-clay-300 bg-clay-100 px-3 py-2 text-sm text-clay-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          // HEIC is what an iPhone actually produces; the API decodes it and converts to WebP.
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          onChange={(e) => e.target.files && upload(e.target.files)}
          className="text-sm text-sand-700 file:mr-3 file:rounded-card file:border-0 file:bg-brand-700 file:px-4 file:py-2 file:text-white"
        />
        {uploading > 0 ? (
          <span className="text-sm text-sand-600" aria-live="polite">
            Uploading {uploading}…
          </span>
        ) : (
          added > 0 && (
            <span className="text-sm text-status-active" role="status" aria-live="polite">
              {added} photo{added === 1 ? "" : "s"} added and saved.
            </span>
          )
        )}
      </div>

      {photos.length === 0 ? (
        <p className="rounded-card border border-dashed border-sand-300 px-4 py-8 text-center text-sm text-sand-600">
          No photos yet. Listings with photos get substantially more enquiries.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <li key={photo.id} className="overflow-hidden rounded-card border border-sand-200 bg-white">
              <div className="relative aspect-4/3 bg-sand-100">
                {photo.status === "READY" ? (
                  /*
                    Plain <img>, not next/image. The API already serves correctly sized WebP
                    variants behind an RLS check tied to the caller; Next's optimizer would refetch
                    them server-side without that session, which for a private or draft listing
                    means broken images at best.
                  */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/media/${photo.id}/thumb`}
                    alt={photo.caption || "Listing photo"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-2 text-center text-xs text-sand-600">
                    {photo.status === "FAILED" ? (
                      <span className="text-clay-700">{photo.error ?? "Processing failed"}</span>
                    ) : (
                      "Processing…"
                    )}
                  </div>
                )}
                {index === 0 && photo.status === "READY" && (
                  <span className="absolute left-2 top-2 rounded-full bg-brand-700 px-2 py-0.5 text-xs text-white">
                    Hero
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move earlier"
                    className="rounded px-1.5 text-sand-600 hover:bg-sand-100 disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === photos.length - 1}
                    aria-label="Move later"
                    className="rounded px-1.5 text-sand-600 hover:bg-sand-100 disabled:opacity-30"
                  >
                    →
                  </button>
                  {index !== 0 && (
                    <button
                      type="button"
                      onClick={() => makeHero(index)}
                      className="rounded px-1.5 text-xs text-brand-700 hover:bg-sand-100"
                    >
                      Make hero
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(photo.id)}
                  aria-label="Delete photo"
                  className="rounded px-1.5 text-clay-600 hover:bg-clay-100"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
