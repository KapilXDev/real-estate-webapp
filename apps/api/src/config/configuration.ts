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

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
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

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(5),
  /** Minimum gap between OTP sends to one destination. SMS-pumping fraud costs real money. */
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),

  CORS_ORIGINS: z.string().default("http://localhost:3000"),
});

export type AppConfig = z.infer<typeof schema> & {
  corsOrigins: string[];
  isProduction: boolean;
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
  };
}

/** DI token for the validated config. */
export const APP_CONFIG = Symbol("APP_CONFIG");
