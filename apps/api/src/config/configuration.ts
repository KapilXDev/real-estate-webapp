import { z } from "zod";

/**
 * Environment configuration, validated at boot.
 *
 * Fail fast and loudly: a missing JWT secret or database URL discovered on the first request is
 * far worse than one discovered at startup, and in the JWT case a permissive default would be a
 * silent security hole rather than an outage.
 */

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  /**
   * OWNER connection — migrations, seed, bootstrap. DDL rights, and in local Docker a superuser.
   * The API must NOT serve requests through this; see APP_DATABASE_URL.
   */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  /**
   * ⚠️ RUNTIME connection, and the reason tenant isolation works at all.
   *
   * A superuser (or any BYPASSRLS role) IGNORES row-level security outright — FORCE does not
   * apply to it and no policy is ever consulted. The Docker image makes POSTGRES_USER a
   * superuser, so serving requests over DATABASE_URL silently disables every policy in 0010.
   *
   * This points at `tricity_app` (migration 0013): NOSUPERUSER, NOBYPASSRLS, DML only.
   * `assertRuntimeRoleCannotBypassRls()` refuses to boot if it resolves to a privileged role.
   *
   * Falls back to DATABASE_URL only so an existing checkout still boots — the startup assertion
   * then fails loudly with instructions, which is the intended outcome rather than a silent
   * downgrade to no isolation.
   */
  APP_DATABASE_URL: z.string().min(1).optional(),

  /** API pool size. Kept separate from worker pools — see the bulkhead note in client.ts. */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  /**
   * ⚠️ No default, deliberately. A fallback secret is worse than a crash: every deployment that
   * forgot to set one would share a signing key, and any of them could mint tokens for the others.
   */
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),

  /**
   * Short-lived by design — revocation is handled by refresh rotation, not by access tokens.
   *
   * The regex is not cosmetic: jsonwebtoken accepts a bare number as SECONDS but a bare numeric
   * STRING is rejected, and a typo like "15mins" is silently treated as... nothing predictable.
   * Requiring an explicit unit turns a subtle token-lifetime bug into a startup failure.
   */
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^\d+[smhd]$/, "JWT_ACCESS_TTL must look like 15m, 2h or 7d")
    .default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /**
   * How long a just-rotated refresh token keeps working — the "reuse interval".
   *
   * ⚠️ THIS EXISTS BECAUSE STRICT ROTATION SIGNS LEGITIMATE USERS OUT. Refresh tokens rotate and
   * a replay is treated as theft, which burns the whole family. But a browser with two tabs sends
   * both requests carrying the SAME cookie — the second was already in flight when the first
   * response rewrote it — so the second looks exactly like a replay. Measured before this existed:
   * two concurrent requests after the access cookie expired were enough to revoke the family and
   * sign the agent out of everything.
   *
   * Inside the window a straggler is served instead of being treated as an attack. Outside it,
   * detection is unchanged. Auth0 and Okta both ship the same mechanism (Auth0 defaults to 3s);
   * 10s is chosen for a market on patchy mobile connections, where an in-flight request can take
   * seconds to land.
   *
   * The security cost is real and bounded: a stolen refresh token replayed within the window gets
   * a session without tripping detection. Weighed against an attacker who by then already holds
   * the httpOnly cookie — and against the alternative, which is users being signed out so often
   * that the pressure becomes "make the tokens last longer" or "stop rotating", both strictly
   * worse. Capped at 60s so it cannot be widened into a hole by configuration alone.
   */
  REFRESH_ROTATION_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(5),
  /** Minimum gap between OTP sends to one destination. SMS-pumping fraud costs real money. */
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),

  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  /* --- Object storage (listing photos) ------------------------------------------------ */

  /**
   * ⚠️ Set for MinIO / R2 / Spaces; LEAVE UNSET for real AWS S3.
   *
   * When present the client also switches to path-style URLs, which MinIO requires — the SDK
   * default of `https://bucket.host/key` needs wildcard DNS and fails against localhost with a
   * connection error that looks like the server is down rather than like a URL-style mismatch.
   */
  MEDIA_ENDPOINT: z.string().optional(),
  MEDIA_REGION: z.string().default("us-east-1"),
  MEDIA_BUCKET: z.string().default("tricity-media"),
  MEDIA_ACCESS_KEY: z.string().default("tricity"),
  MEDIA_SECRET_KEY: z.string().default("tricity_dev_password"),
});

export type AppConfig = z.infer<typeof schema> & {
  corsOrigins: string[];
  isProduction: boolean;
  /** What the API actually connects as. APP_DATABASE_URL when set, else DATABASE_URL. */
  runtimeDatabaseUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    isProduction: parsed.data.NODE_ENV === "production",
    runtimeDatabaseUrl: parsed.data.APP_DATABASE_URL ?? parsed.data.DATABASE_URL,
  };
}

/** DI token for the validated config. */
export const APP_CONFIG = Symbol("APP_CONFIG");
