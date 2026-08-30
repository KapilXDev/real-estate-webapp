import { Module } from "@nestjs/common";

import { IdentityModule } from "../identity/identity.module";
import {
  MediaDeliveryController,
  StaffMediaController,
  StaffMediaDeliveryController,
} from "./controllers/media.controller";
import { MediaRepository } from "./repositories/media.repository";
import { ImageProcessingService } from "./services/image-processing.service";
import { MediaService } from "./services/media.service";
import { ObjectStorageService } from "./services/object-storage.service";

/**
 * Listing photos.
 *
 * Layered like catalog/ and leads/ — see catalog.module.ts for the convention and why it exists.
 * ObjectStorageService and ImageProcessingService sit in services/ rather than a separate
 * infrastructure layer: they are decisions-with-side-effects (which variants, which formats are
 * safe to decode), not data access, and neither touches Postgres.
 */
@Module({
  imports: [IdentityModule],
  controllers: [MediaDeliveryController, StaffMediaDeliveryController, StaffMediaController],
  providers: [MediaService, MediaRepository, ObjectStorageService, ImageProcessingService],
  exports: [MediaService],
})
export class MediaModule {}
