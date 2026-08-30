import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * Image derivatives.
 *
 * ⚠️ THE POINT OF THIS SERVICE IS LCP. Agents upload straight from a phone camera roll — 4-8 MB,
 * 4032px wide. Serving that as a listing hero blows the < 2.5s LCP target on the mobile
 * connections most of these buyers are on, and the listing page is where the decision to call
 * gets made. Resizing at upload time is the cheapest possible fix: paid once, per photo, by the
 * agent, instead of on every buyer's page load.
 */

/**
 * The variants every photo is resized into.
 *
 * Widths, not heights — layout is width-driven and aspect ratios vary. `withoutEnlargement` means
 * a small upload is never upscaled into a blurry larger file that is bigger than the original.
 *
 * ⚠️ The ORIGINAL is kept alongside these. It costs storage and it buys the ability to re-derive
 * everything when the variant set changes (adding AVIF, adding a retina hero) without asking
 * agents to re-upload. Throwing it away is a one-way door.
 */
export const VARIANTS = [
  /** Thumbnails in the admin UI and the photo strip. */
  { name: "thumb", width: 400, quality: 72 },
  /** Search result cards — by far the most-requested variant. */
  { name: "card", width: 800, quality: 78 },
  /** Listing page hero. */
  { name: "hero", width: 1600, quality: 82 },
] as const;

export type VariantName = (typeof VARIANTS)[number]["name"];

export interface ProcessedVariant {
  name: string;
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
  contentType: string;
}

export interface ProcessedImage {
  checksum: string;
  originalBytes: number;
  originalMime: string;
  width: number;
  height: number;
  variants: ProcessedVariant[];
}

export class UnsupportedImageError extends Error {}

/** What we are willing to decode. Deliberately short — see the note in `process`. */
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "heif", "avif", "tiff"]);

@Injectable()
export class ImageProcessingService {
  private readonly logger = new Logger(ImageProcessingService.name);

  async process(original: Buffer): Promise<ProcessedImage> {
    /*
     * ⚠️ THE FORMAT IS DETERMINED BY DECODING THE BYTES, never by the filename or the
     * client-supplied Content-Type. Both are attacker-controlled. `photo.jpg` containing an SVG
     * with a script tag, served back with an image content type, is a stored-XSS delivery
     * mechanism — which is exactly why SVG is absent from ACCEPTED_FORMATS despite being an image
     * format: it is a document format that executes.
     */
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(original).metadata();
    } catch {
      throw new UnsupportedImageError(
        "That file could not be read as an image. Upload a JPEG, PNG, WebP or HEIC.",
      );
    }

    if (!metadata.format || !ACCEPTED_FORMATS.has(metadata.format)) {
      throw new UnsupportedImageError(
        `Unsupported image format "${metadata.format ?? "unknown"}". ` +
          "Upload a JPEG, PNG, WebP or HEIC.",
      );
    }

    if (!metadata.width || !metadata.height) {
      throw new UnsupportedImageError("That image has no readable dimensions.");
    }

    /*
     * ⚠️ DECOMPRESSION BOMB GUARD. A few-hundred-KB PNG can declare 50,000 × 50,000 pixels, and
     * decoding it allocates ~10 GB. The byte-size limit on the upload endpoint does not catch
     * this at all, because the *compressed* file is small. Checked against the declared header
     * dimensions, before any pixels are decoded.
     */
    const megapixels = (metadata.width * metadata.height) / 1_000_000;
    if (megapixels > 80) {
      throw new UnsupportedImageError(
        `That image is ${Math.round(megapixels)} megapixels, which is too large to process. ` +
          "Even a 100MP phone camera is under this — the file may be corrupt.",
      );
    }

    const checksum = createHash("sha256").update(original).digest("hex");

    const variants: ProcessedVariant[] = [];
    for (const variant of VARIANTS) {
      const pipeline = sharp(original, { failOn: "error" })
        /*
         * ⚠️ `rotate()` with no argument applies the EXIF orientation tag and then strips it.
         * Without it, every portrait photo taken on a phone renders sideways — the pixels are
         * stored landscape and only the EXIF tag says otherwise, and resizing discards metadata.
         * This is the single most visible bug in any naive image pipeline.
         */
        .rotate()
        .resize({ width: variant.width, withoutEnlargement: true })
        .webp({ quality: variant.quality });

      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      variants.push({
        name: variant.name,
        buffer: data,
        width: info.width,
        height: info.height,
        bytes: data.byteLength,
        contentType: "image/webp",
      });
    }

    this.logger.debug(
      `Processed ${metadata.width}x${metadata.height} ${metadata.format} ` +
        `(${Math.round(original.byteLength / 1024)}KB) into ${variants.length} variants`,
    );

    return {
      checksum,
      originalBytes: original.byteLength,
      originalMime: `image/${metadata.format}`,
      // Reported post-rotation, so they match what the variants and the browser actually show.
      width: metadata.autoOrient?.width ?? metadata.width,
      height: metadata.autoOrient?.height ?? metadata.height,
      variants,
    };
  }
}
