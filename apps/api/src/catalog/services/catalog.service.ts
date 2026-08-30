import { Injectable, Logger } from "@nestjs/common";
import type {
  ListingDto,
  ListingSearchParamsDto,
  ListingSearchResponseDto,
  MarketStatsDto,
} from "@tricity/contracts";

import type { ListingRow } from "../dao/listing.row";
import { ListingMappingError, toListingDto } from "../mappers/listing.mapper";
import { ListingRepository } from "../repositories/listing.repository";

/**
 * Public catalog reads — what an anonymous visitor to the website gets.
 *
 * The service owns policy that is neither SQL nor HTTP: how many rows a page may request, what
 * counts as enough inventory to publish a statistic, and what to do with a row the mapper cannot
 * represent. The repository below it knows only queries; the controller above it knows only
 * request and response.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  /**
   * A market report over three listings is noise presented as insight — and once published, a
   * buyer will quote it back. Below this many active listings, `getMarketStats` returns null and
   * the page renders nothing rather than a number nobody should act on.
   */
  private static readonly MIN_SAMPLE_FOR_STATS = 5;

  constructor(private readonly listings: ListingRepository) {}

  /**
   * Map rows to the wire, attaching media, and DROP anything unmappable.
   *
   * ⚠️ A row the mapper rejects is logged and skipped rather than thrown. The repository already
   * filters non-public statuses and property types, so reaching this is a bug — but the blast
   * radius of that bug should be one missing card, not a 500 on the search page that takes the
   * whole catalog down. The log line is what makes it findable.
   */
  private async toDtos(rows: ListingRow[]): Promise<ListingDto[]> {
    if (rows.length === 0) return [];

    const mediaByListing = await this.listings.findMedia(rows.map((r) => r.id));

    const dtos: ListingDto[] = [];
    for (const row of rows) {
      try {
        dtos.push(toListingDto(row, mediaByListing.get(row.id) ?? []));
      } catch (error) {
        if (error instanceof ListingMappingError) {
          this.logger.error(`Skipping unmappable listing ${row.id}: ${error.message}`);
          continue;
        }
        throw error;
      }
    }
    return dtos;
  }

  async search(params: ListingSearchParamsDto): Promise<ListingSearchResponseDto> {
    const page = Math.max(1, params.page ?? 1);
    /*
     * ⚠️ Clamped, not validated-and-rejected. `pageSize=100000` on a public unauthenticated
     * endpoint is a cheap way to make the server assemble an enormous response; a 400 would be
     * correct but a clamp is friendlier to a legitimate client that guessed wrong, and equally
     * effective at capping the work. The DTO also caps it — this is the backstop for any caller
     * that reaches the service directly.
     */
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 24));

    const { rows, total } = await this.listings.search({ ...params, page, pageSize });
    return { listings: await this.toDtos(rows), total, page, pageSize };
  }

  async getByKey(listingKey: string): Promise<ListingDto | null> {
    const row = await this.listings.findByKey(listingKey);
    if (!row) return null;
    const [dto] = await this.toDtos([row]);
    return dto ?? null;
  }

  async getHostListings(opts: { includeSold?: boolean } = {}): Promise<ListingDto[]> {
    return this.toDtos(await this.listings.findHostListings(opts));
  }

  async getByLocality(
    ref: { citySlug: string; localitySlug: string },
    limit = 12,
  ): Promise<ListingDto[]> {
    return this.toDtos(await this.listings.findByLocality(ref, limit));
  }

  async getByCity(citySlug: string, limit = 12): Promise<ListingDto[]> {
    return this.toDtos(await this.listings.findByCity(citySlug, limit));
  }

  /**
   * Aggregate statistics for a locality.
   *
   * Returns null below `MIN_SAMPLE_FOR_STATS`, and null for individual figures that have no
   * sample — `medianClosePrice` is null when nothing closed in the window, rather than 0, because
   * a rendered "₹0" is a factual claim about the market and a null is an absence the UI can hide.
   */
  async getMarketStats(ref: {
    citySlug: string;
    localitySlug: string;
  }): Promise<MarketStatsDto | null> {
    const row = await this.listings.marketStats(ref);
    if (!row) return null;

    const activeCount = Number(row.active_count);
    if (activeCount < CatalogService.MIN_SAMPLE_FOR_STATS) return null;

    const num = (value: string | null): number | null => {
      if (value === null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const median = num(row.median_list_price) ?? 0;
    const prior = num(row.median_list_price_prior);

    return {
      citySlug: ref.citySlug,
      localitySlug: ref.localitySlug,
      activeCount,
      medianListPrice: median,
      medianPricePerSqft: Math.round(num(row.median_price_per_sqft) ?? 0),
      medianDaysOnMarket: Math.round(num(row.median_days_on_market) ?? 0),
      closedLast90Days: Number(row.closed_last_90),
      medianClosePrice: num(row.median_close_price),
      // Guard the divisor explicitly: with no prior window `prior` is null, and 0 would make this
      // Infinity — which renders as "∞% up this quarter" on a market report page.
      priceChangePercent:
        prior !== null && prior > 0 ? Number((((median - prior) / prior) * 100).toFixed(1)) : null,
      generatedAt: new Date().toISOString(),
    };
  }
}
