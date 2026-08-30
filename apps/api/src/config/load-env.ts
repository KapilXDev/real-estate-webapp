import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * Loads the repo-root `.env` into `process.env`.
 *
 * WHY THIS EXISTS: `@nestjs/config` was removed (its v12 line is pure ESM and cannot be imported
 * from this CommonJS app), and nothing replaced its .env loading. Without it every entrypoint —
 * `nest start`, the migration runner, the seeder — sees an empty DATABASE_URL and dies at boot
 * blaming the operator for a missing file that is actually present.
 *
 * WHY `util.parseEnv` RATHER THAN `process.loadEnvFile()`: loadEnvFile OVERWRITES variables that
 * are already set. In a real deployment configuration arrives from the platform (Kubernetes
 * secrets, CI), and a stray .env silently winning over an injected DATABASE_URL is how a staging
 * process ends up writing to a dev database. Here, existing values always win.
 *
 * WHY NO dotenv DEPENDENCY: `parseEnv` is built into Node >= 20.12 and this repo requires >= 20.
 *
 * ⚠️ WHY THE UPWARD WALK RATHER THAN A FIXED `../../../..`: this file runs from two different
 * depths. Under tsx (migrate/seed) __dirname is `apps/api/src/config`; compiled it is
 * `apps/api/dist/apps/api/src/config`, because tsconfig sets `rootDir: "../../"` (required so the
 * compiler accepts cross-package source) and tsc mirrors that path under outDir. A hardcoded
 * relative hop is therefore correct in exactly one of the two and silently resolves to a
 * nonexistent path in the other — which presents as "DATABASE_URL is not set", pointing at the
 * wrong problem entirely.
 *
 * Absence of the file is not an error — that is the normal production case.
 */

/** Marks the repo root: the workspace root package.json, which no sub-package has. */
function isRepoRoot(dir: string): boolean {
  const pkg = path.join(dir, "package.json");
  if (!existsSync(pkg)) return false;
  try {
    return Array.isArray(JSON.parse(readFileSync(pkg, "utf8")).workspaces);
  } catch {
    return false;
  }
}

function findRepoRoot(start: string): string | undefined {
  let dir = path.resolve(start);
  // Terminates: path.dirname of a filesystem root returns the root itself.
  for (;;) {
    if (isRepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

let loaded = false;

export function loadEnvFile(explicitPath?: string): void {
  // Several entrypoints import this; parsing once keeps the "existing values win" rule from
  // being applied against our own earlier writes.
  if (loaded) return;
  loaded = true;

  // __dirname first: it tracks the installed code. cwd is a fallback for the case where the
  // build output has been relocated away from the source tree.
  const root = explicitPath ? undefined : (findRepoRoot(__dirname) ?? findRepoRoot(process.cwd()));
  const envPath = explicitPath ?? (root === undefined ? undefined : path.join(root, ".env"));
  if (envPath === undefined) return;

  let contents: string;
  try {
    contents = readFileSync(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const [key, value] of Object.entries(parseEnv(contents))) {
    if (process.env[key] === undefined && typeof value === "string") {
      process.env[key] = value;
    }
  }
}
