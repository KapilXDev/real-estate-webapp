import type { ListingMedia } from "@/lib/listings/types";

/**
 * A listing photo.
 *
 * ⚠️ A PLAIN `<img>`, NOT `next/image`, AND THAT IS DELIBERATE.
 *
 * The API already produces exactly the sizes this layout needs — 400 / 800 / 1600 px WebP,
 * generated once at upload. Routing them through the image optimizer would fetch our 800px WebP
 * and re-encode it: paying twice for work already done, on every cache miss.
 *
 * It also removes a genuinely nasty failure mode. `next/image` refuses any host not listed in
 * `images.remotePatterns`, and the media host is an environment variable — the API in dev, a CDN
 * in production. When those disagree the optimizer returns `400 "url" parameter is not allowed`
 * and **the page still renders**, just with every photo blank. No error, no log, nothing to
 * notice in review. That is exactly how this shipped broken.
 *
 * What we give up is automatic srcset generation, which we do not need: we have our own variants
 * and they are more appropriate than anything derived from a single source image.
 *
 * ⚠️ Also note, from the Next docs: the optimizer does not forward request headers when fetching
 * a source image. Public listings do not care, but the admin's photos are behind a session — so
 * the same choice is forced there for a different reason. Consistency here is a bonus, not the
 * reason.
 */
export function ListingImage({
  media,
  alt,
  sizes,
  className,
  priority = false,
}: {
  media: ListingMedia | undefined;
  alt: string;
  /** Standard `sizes` attribute — tells the browser which srcset entry to pick before layout. */
  sizes: string;
  className?: string;
  /**
   * The LCP image on a page (a listing hero, the first card above the fold).
   *
   * Sets `fetchpriority="high"` and disables lazy loading. Everything else stays lazy — the LCP
   * target is < 2.5s and lazy-loading the hero is the single most common way to miss it.
   */
  priority?: boolean;
}) {
  if (!media) {
    return (
      <div
        className={`flex items-center justify-center bg-sand-100 text-sand-400 ${className ?? ""}`}
        aria-hidden="true"
      >
        <span className="text-sm">No photo</span>
      </div>
    );
  }

  // Variants are absent for MockProvider (its placeholder route serves one size), so fall back to
  // the single url rather than emitting an empty srcset, which browsers handle inconsistently.
  const srcSet = media.variants?.length
    ? media.variants.map((v) => `${v.url} ${v.width}w`).join(", ")
    : undefined;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the note above; intentional.
    <img
      src={media.url}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      className={className}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      // Async decoding keeps a large photo from blocking the main thread during scroll.
      decoding="async"
    />
  );
}
