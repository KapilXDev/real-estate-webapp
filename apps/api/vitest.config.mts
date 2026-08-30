import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],

    // Builds the migrated + seeded template database that every suite clones.
    globalSetup: ["./test/global-setup.ts"],

    /*
     * Every integration suite here talks to Postgres, so the default worker-per-core fan-out buys
     * nothing but connection pressure and CREATE DATABASE contention. Two is enough to overlap
     * query latency without turning the database into the bottleneck.
     */
    maxWorkers: 2,

    // Migrating + seeding the template takes a few seconds on a cold container.
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
