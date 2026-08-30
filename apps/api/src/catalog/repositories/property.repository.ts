import { Injectable } from "@nestjs/common";

import { DatabaseService, type TenantContext } from "../../database/database.service";

export interface PropertyInput {
  localityId: string;
  propertyType: string;
  lat: number;
  lng: number;
  addressLine?: string;
  plotNumber?: string;
  pincode?: string;
  projectId?: string;
  plotAreaSqft?: number;
  builtUpAreaSqft?: number;
  carpetAreaSqft?: number;
  areaInputValue?: number;
  areaInputUnit?: string;
  areaConversionFactor?: number;
  areaInputBasis?: "PLOT" | "BUILT_UP" | "CARPET";
  bedrooms?: number;
  bathrooms?: number;
  balconies?: number;
  totalFloors?: number;
  floorNumber?: number;
  facing?: string;
  yearBuilt?: number;
}

/**
 * Properties — the physical asset, as distinct from the offer to transact on it.
 *
 * ⚠️ `property` IS NOT UNDER RLS, and that is deliberate (see 0010). It describes physical reality
 * shared by every tenant, and duplicate detection has to see ACROSS organisations to work at all:
 * two brokers listing the same kothi in Mohali Phase 7 must produce ONE property with TWO
 * listings, not a duplicated search result. Putting it behind tenant scoping would make each org
 * blind to the other's row and guarantee the duplicate it is supposed to prevent.
 *
 * The writes still run inside `withTenant` so the surrounding transaction has a tenant context for
 * the `listing` insert that follows.
 */
@Injectable()
export class PropertyRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Find an existing property at the same address, or create one.
   *
   * ⚠️ DEDUPE IS DELIBERATELY CONSERVATIVE: it matches only on (locality, plot number), which is
   * backed by `property_dedupe_idx`. Fuzzy matching on coordinates or address text is tempting and
   * wrong at this stage — merging two properties that are actually different is a far worse
   * failure than listing one twice. A false merge attributes one broker's listing to another's
   * building and is close to impossible to unpick once leads are attached to it; a false duplicate
   * is a visible, fixable annoyance.
   *
   * Properties with no plot number always insert. Most flats have none, and matching them on
   * anything looser would collapse an entire tower into one row.
   */
  async findOrCreate(input: PropertyInput, context: TenantContext): Promise<string> {
    return this.database.withTenant(context, async (tx) => {
      if (input.plotNumber) {
        const existing = await tx<{ id: string }[]>`
          SELECT id FROM property
          WHERE locality_id = ${input.localityId}
            AND plot_number = ${input.plotNumber}
          LIMIT 1
        `;
        if (existing[0]) return existing[0].id;
      }

      const rows = await tx<{ id: string }[]>`
        INSERT INTO property (
          locality_id, property_type, location, address_line, plot_number, pincode, project_id,
          plot_area_sqft, built_up_area_sqft, carpet_area_sqft,
          area_input_value, area_input_unit, area_conversion_factor, area_input_basis,
          bedrooms, bathrooms, balconies, total_floors, floor_number, facing, year_built
        ) VALUES (
          ${input.localityId},
          ${input.propertyType}::property_type,
          -- ⚠️ ST_MakePoint is (X, Y) = (LONGITUDE, LATITUDE). Reversing them is the classic
          -- PostGIS bug: it produces a valid point in the wrong hemisphere, so nothing errors and
          -- the listing simply never appears in any map search.
          ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography,
          ${input.addressLine ?? null},
          ${input.plotNumber ?? null},
          ${input.pincode ?? null},
          ${input.projectId ?? null},
          ${input.plotAreaSqft ?? null},
          ${input.builtUpAreaSqft ?? null},
          ${input.carpetAreaSqft ?? null},
          ${input.areaInputValue ?? null},
          ${input.areaInputUnit ?? null}::area_unit,
          ${input.areaConversionFactor ?? null},
          ${input.areaInputBasis ?? null}::area_basis,
          ${input.bedrooms ?? null},
          ${input.bathrooms ?? null},
          ${input.balconies ?? null},
          ${input.totalFloors ?? null},
          ${input.floorNumber ?? null},
          ${input.facing ?? null}::facing,
          ${input.yearBuilt ?? null}
        )
        RETURNING id
      `;

      if (!rows[0]) throw new Error("property insert returned no row");
      return rows[0].id;
    });
  }

  /**
   * The state a locality sits in — the RERA jurisdiction for anything listed there.
   *
   * Separate from `resolveLocality` because the publication gate needs it BEFORE a property row
   * exists: an agent must be told they cannot publish in Chandigarh before the write happens, not
   * after a property has already been created and orphaned.
   */
  async stateForLocality(
    citySlug: string,
    localitySlug: string,
    context: TenantContext,
  ): Promise<string | null> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<{ state: string }[]>`
        SELECT c.state
        FROM locality loc
        JOIN city c ON c.id = loc.city_id
        WHERE c.slug = ${citySlug} AND loc.slug = ${localitySlug}
        LIMIT 1
      `;
      return rows[0]?.state ?? null;
    });
  }

  /** Resolve a (city, locality) slug pair to a locality id. Null when either slug is unknown. */
  async resolveLocality(
    citySlug: string,
    localitySlug: string,
    context: TenantContext,
  ): Promise<string | null> {
    return this.database.withTenant(context, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT loc.id
        FROM locality loc
        JOIN city c ON c.id = loc.city_id
        WHERE c.slug = ${citySlug} AND loc.slug = ${localitySlug}
        LIMIT 1
      `;
      return rows[0]?.id ?? null;
    });
  }
}
