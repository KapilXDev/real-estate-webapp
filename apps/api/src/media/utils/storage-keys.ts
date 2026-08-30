/**
 * Object key layout.
 *
 *   listings/{listingId}/{mediaId}/original
 *   listings/{listingId}/{mediaId}/{variant}.webp
 *
 * ⚠️ THE LISTING ID IS THE FIRST SEGMENT ON PURPOSE. S3 delete-by-prefix is the only cheap way to
 * remove every object belonging to a listing, and a flat `media/{uuid}` layout makes that
 * impossible without first listing every key from the database — which fails exactly when you
 * need it (the row is already gone, or the delete is a cleanup after a partial failure).
 *
 * ⚠️ NO USER-SUPPLIED TEXT IN KEYS. Not the original filename, not the caption. Filenames arrive
 * from a browser with whatever characters the OS allowed, including `../`, and a key is a path.
 * Both segments here are server-generated uuids, so there is nothing to traverse with.
 * The original filename, if it is ever wanted, belongs in a column.
 */

export function originalKey(listingId: string, mediaId: string): string {
  return `listings/${listingId}/${mediaId}/original`;
}

export function variantKey(listingId: string, mediaId: string, variant: string): string {
  return `listings/${listingId}/${mediaId}/${variant}.webp`;
}

/** Every object for one media row — what a delete needs to sweep. */
export function allKeysFor(listingId: string, mediaId: string, variants: string[]): string[] {
  return [
    originalKey(listingId, mediaId),
    ...variants.map((v) => variantKey(listingId, mediaId, v)),
  ];
}
