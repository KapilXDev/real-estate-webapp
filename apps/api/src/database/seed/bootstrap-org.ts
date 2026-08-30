import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import * as argon2 from "argon2";
import postgres from "postgres";

import { loadEnvFile } from "../../config/load-env";

/**
 * First-run bootstrap: creates the host organisation and its OWNER account.
 *
 * WHY THIS EXISTS AS A SEPARATE ENTRYPOINT: there is deliberately no public staff-registration
 * route. Staff accounts are created by invitation from an existing admin, which leaves an
 * unavoidable chicken-and-egg at install time — the first admin has nobody to invite them.
 * Every alternative is worse: a self-service /auth/staff/register endpoint is an open door onto
 * the tenant that owns the whole platform, and a hardcoded default credential is the single most
 * reliably exploited misconfiguration there is. A one-shot operator command, run out of band,
 * closes the gap without leaving anything reachable over HTTP.
 *
 * ⚠️ RLS: `app_user` is under FORCE ROW LEVEL SECURITY, so the INSERT is evaluated against
 * `app_user_tenant_policy` even though we connect as the table owner (that is the whole point of
 * FORCE — see 0010). The row is therefore written inside a transaction that has set
 * `app.current_org_id` to the new organisation, which satisfies the policy's WITH CHECK honestly.
 * Setting `app.is_platform_admin` would also work and is deliberately NOT done: it would grant
 * this script write access to every table in the schema to insert one row.
 *
 * `organization` itself is intentionally not under RLS (a tenant table cannot gate the creation
 * of tenants), so it is inserted before the context is set.
 *
 * Idempotent on the organisation (ON CONFLICT on slug), NOT on the user: an existing email is a
 * hard error rather than a silent password reset, because "bootstrap ran twice in CI" and
 * "someone is resetting the owner's credentials" look identical from here.
 *
 * Usage:
 *   npm run db:bootstrap -- --email owner@example.com --name "Full Name" \
 *     --org "Firm Name" [--org-slug firm-name] [--org-type BROKERAGE] [--password ...]
 *
 * With no --password a strong one is generated and printed ONCE. It is never stored in plaintext
 * and cannot be recovered afterwards.
 */

const ORG_TYPES = ["BROKERAGE", "PARTNER", "BUILDER"] as const;
type OrgType = (typeof ORG_TYPES)[number];

/** Mirrors the MinLength(10) on StaffLoginDto — a password this script accepts must be loginable. */
const MIN_PASSWORD_LENGTH = 10;

/**
 * Argon2id parameters, kept in lockstep with PasswordService.
 *
 * ⚠️ Duplicated rather than imported: PasswordService is an @Injectable and pulling it in here
 * would drag the Nest DI container into a standalone script. The cost of the copy is that a
 * change there must be mirrored here — but a mismatch is self-healing rather than dangerous,
 * because `needsRehash` upgrades the hash on the owner's first successful login.
 */
const HASH_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * base64url of 18 random bytes — 144 bits, no ambiguous-character problem, and safe to paste
 * through a shell without quoting.
 */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

export interface BootstrapOptions {
  orgName: string;
  orgSlug: string;
  orgType: OrgType;
  email: string;
  fullName: string;
  password: string;
}

export interface BootstrapResult {
  organizationId: string;
  organizationCreated: boolean;
  userId: string;
}

export async function bootstrapOrg(
  connectionString: string,
  options: BootstrapOptions,
): Promise<BootstrapResult> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });

  try {
    const passwordHash = await argon2.hash(options.password, HASH_OPTIONS);

    return await sql.begin(async (tx) => {
      /*
       * DO UPDATE rather than DO NOTHING: DO NOTHING returns zero rows on conflict, so RETURNING
       * would give us nothing back and we would have to re-SELECT. The no-op update to `name`
       * keeps the row unchanged in practice while guaranteeing a returned id.
       */
      const [org] = await tx<{ id: string; created: boolean }[]>`
        INSERT INTO organization (name, slug, type, status)
        VALUES (${options.orgName}, ${options.orgSlug}, ${options.orgType}::org_type, 'ACTIVE')
        ON CONFLICT (slug) DO UPDATE SET name = organization.name
        RETURNING id, (xmax = 0) AS created
      `;

      if (!org) throw new Error("Organisation insert returned no row");

      // Satisfies app_user_tenant_policy's WITH CHECK. Transaction-local (third arg `true`), so
      // it dies with this transaction and cannot leak onto a pooled connection.
      await tx`SELECT set_config('app.current_org_id', ${org.id}, true)`;

      const [user] = await tx<{ id: string }[]>`
        INSERT INTO app_user (organization_id, email, password_hash, full_name, role, status)
        VALUES (
          ${org.id},
          ${options.email},
          ${passwordHash},
          ${options.fullName},
          'OWNER'::user_role,
          'ACTIVE'::user_status
        )
        RETURNING id
      `;

      if (!user) throw new Error("User insert returned no row");

      return {
        organizationId: org.id,
        organizationCreated: org.created,
        userId: user.id,
      };
    });
  } finally {
    await sql.end();
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnvFile();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    fail("DATABASE_URL is not set. Copy .env.example to .env first.");
  }

  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      org: { type: "string" },
      "org-slug": { type: "string" },
      "org-type": { type: "string", default: "BROKERAGE" },
      password: { type: "string" },
    },
    // The npm-script indirection means argv is not the usual shape; be explicit.
    args: process.argv.slice(2),
  });

  if (!values.email) fail("--email is required");
  if (!values.name) fail("--name is required");
  if (!values.org) fail("--org is required (the firm's display name)");

  const email = values.email.trim().toLowerCase();
  // Not a full RFC validator — just enough to catch a shell-mangled argument before we hash a
  // password against it. The real validation is class-validator's on the login DTO.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${email}" is not a valid email address`);

  const orgType = values["org-type"]?.toUpperCase();
  if (!ORG_TYPES.includes(orgType as OrgType)) {
    fail(`--org-type must be one of ${ORG_TYPES.join(", ")}`);
  }

  const orgSlug = values["org-slug"]?.trim() || slugify(values.org);
  if (!orgSlug) fail("Could not derive a slug from --org; pass --org-slug explicitly");

  const generated = values.password === undefined;
  const password = values.password ?? generatePassword();
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters (the login DTO enforces it)`);
  }

  let result: BootstrapResult;
  try {
    result = await bootstrapOrg(connectionString, {
      orgName: values.org.trim(),
      orgSlug,
      orgType: orgType as OrgType,
      email,
      fullName: values.name.trim(),
      password,
    });
  } catch (error) {
    // 23505 = unique_violation. The only unique constraint reachable past the org upsert is
    // app_user_email_key, so name the actual problem instead of printing a raw driver error.
    if ((error as { code?: string }).code === "23505") {
      fail(`An account already exists for ${email}. Bootstrap does not reset passwords.`);
    }
    throw error;
  }

  console.log(
    `\n✔ Organisation ${result.organizationCreated ? "created" : "already existed"}: ` +
      `${values.org} (${orgSlug})\n  id ${result.organizationId}`,
  );
  console.log(`✔ OWNER account created: ${email}\n  id ${result.userId}`);

  if (generated) {
    console.log(
      `\n  ┌─ Generated password — shown once, not recoverable ─┐\n` +
        `  │  ${password}\n` +
        `  └────────────────────────────────────────────────────┘`,
    );
  }

  console.log(`\n  Sign in:  POST /api/auth/staff/login  { "email": "${email}", "password": ... }\n`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("\nBootstrap failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
