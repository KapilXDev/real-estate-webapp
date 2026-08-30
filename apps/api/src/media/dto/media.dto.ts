import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class UploadMediaDto {
  @IsOptional()
  @IsString()
  /** Alt text. Worth real SEO value on a listing page, and required for accessibility. */
  @MaxLength(300)
  caption?: string;
}

export class ReorderMediaDto {
  /**
   * Full ordered list of media ids.
   *
   * ⚠️ `@IsUUID` on every element is not decoration: these go into a `uuid[]` cast in SQL, and a
   * non-uuid string would fail the cast at the database with an opaque error rather than a 400
   * naming the field. Capped because a listing with 200 photos is a data-entry accident.
   */
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID("4", { each: true })
  order!: string[];
}
