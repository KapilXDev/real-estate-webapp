import { buildTemplateDatabase } from "./support/database";

/**
 * Runs ONCE per `vitest` invocation, before any suite.
 *
 * Builds the migrated + seeded template database that every test file clones. See
 * `support/database.ts` for why a template is used rather than migrating per suite, and why
 * Testcontainers was not.
 */
export default async function setup(): Promise<void> {
  await buildTemplateDatabase();
}
