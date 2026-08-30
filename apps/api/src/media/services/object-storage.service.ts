import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Readable } from "node:stream";

import { APP_CONFIG, type AppConfig } from "../../config/configuration";

/**
 * S3-compatible object storage.
 *
 * MinIO locally, and the same code unchanged against AWS S3 / Cloudflare R2 / DigitalOcean Spaces
 * in production — only the endpoint and credentials move. That is the entire reason for using the
 * S3 API rather than writing files to a disk: the disk version works perfectly on a laptop and
 * then loses every photo the first time a container is rescheduled, which is the same failure
 * that made `FileLeadStore` unusable.
 *
 * ⚠️ `forcePathStyle` IS REQUIRED FOR MINIO. The AWS SDK defaults to virtual-hosted-style URLs
 * (`https://bucket.host/key`), which need wildcard DNS. Against `http://localhost:9000` that
 * resolves to `http://tricity-media.localhost:9000` and fails to connect — an error that looks
 * like MinIO is down rather than like a URL-style mismatch.
 */
@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client: S3Client;
  readonly bucket: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.bucket = config.MEDIA_BUCKET;

    const options: S3ClientConfig = {
      region: config.MEDIA_REGION,
      credentials: {
        accessKeyId: config.MEDIA_ACCESS_KEY,
        secretAccessKey: config.MEDIA_SECRET_KEY,
      },
    };

    // Only set for MinIO / R2 / Spaces. Left unset against real S3 so the SDK resolves the
    // regional endpoint itself.
    if (config.MEDIA_ENDPOINT) {
      options.endpoint = config.MEDIA_ENDPOINT;
      options.forcePathStyle = true;
    }

    this.client = new S3Client(options);
  }

  /**
   * Ensure the bucket exists.
   *
   * ⚠️ Does NOT throw on failure, unlike the RLS role check in DatabaseService. The asymmetry is
   * deliberate: a database that cannot enforce tenant isolation must not serve traffic at all,
   * whereas storage being unreachable degrades to "photos do not work" while search, listings and
   * — critically — lead capture keep running. Refusing to boot would turn a photo outage into a
   * total outage and cost leads.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Object storage ready (bucket "${this.bucket}")`);
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created object storage bucket "${this.bucket}"`);
      } catch (error) {
        this.logger.error(
          `Object storage unavailable — photo upload and delivery will fail, but the rest of the ` +
            `API is unaffected: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        /*
         * Derivatives are immutable: the key contains the media id and the variant name, and a
         * reprocess writes new keys rather than overwriting. So they can be cached hard, which is
         * what makes serving them cheap.
         */
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }

  /**
   * Stream an object back.
   *
   * ⚠️ Returns a stream rather than a Buffer. Buffering a 6 MB original into memory per request
   * turns concurrent image loads into heap pressure on the API process, and there is no reason —
   * the response is a pipe from storage to the client.
   */
  async get(key: string): Promise<{ body: Readable; contentType?: string } | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return null;
      return { body: result.Body as Readable, contentType: result.ContentType };
    } catch (error) {
      // NoSuchKey is an expected outcome (deleted media, stale URL), not an error worth logging.
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      this.logger.error(`Failed to read ${key}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * Delete a set of keys.
   *
   * Best-effort by design. An orphaned object costs a fraction of a cent; a delete that throws
   * would leave the database row deleted and the caller believing the operation failed, which is
   * the worse inconsistency. Failures are logged for a sweeper to reconcile later.
   */
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })) },
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to delete ${keys.length} object(s) — they are now orphaned: ` +
          `${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
