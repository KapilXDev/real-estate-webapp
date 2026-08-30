import { Module } from "@nestjs/common";

import { IdentityModule } from "../identity/identity.module";
import { PublicCatalogController } from "./controllers/public-catalog.controller";
import { StaffListingController } from "./controllers/staff-listing.controller";
import { ListingRepository } from "./repositories/listing.repository";
import { ListingWriteRepository } from "./repositories/listing-write.repository";
import { PropertyRepository } from "./repositories/property.repository";
import { ReraRepository } from "./repositories/rera.repository";
import { CatalogService } from "./services/catalog.service";
import { ListingAdminService } from "./services/listing-admin.service";

/**
 * Catalog — properties, listings, and the public search that the website runs on.
 *
 * LAYERS (the convention for every module here):
 *   controllers/    HTTP only. Parse, delegate, map a null to a 404. No decisions.
 *   services/       Business rules — the RERA publication gate, sample-size thresholds, clamps.
 *   repositories/   The ONLY place SQL is written. Every method goes through withTenant().
 *   mappers/        Row -> wire. Pure, synchronous, no dependencies — testable with a literal.
 *   dao/            Row shapes. Hand-written assertions the compiler cannot verify, isolated.
 *   dto/            Inbound validation at the edge.
 *   utils/          Pure helpers: enum translation, SQL fragment composition.
 *
 * The point of the split is that the tenant rule is checkable by reading one directory. If a
 * query exists outside `repositories/`, it is wrong; if a repository method does not call
 * `withTenant`, it is wrong. Both are greppable, which "be careful" is not.
 */
@Module({
  imports: [IdentityModule],
  controllers: [PublicCatalogController, StaffListingController],
  providers: [
    CatalogService,
    ListingAdminService,
    ListingRepository,
    ListingWriteRepository,
    PropertyRepository,
    ReraRepository,
  ],
  exports: [CatalogService, ReraRepository],
})
export class CatalogModule {}
