import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],

    // Builds the migrated + seeded template database that every suite clones.
    globalSetup: ["./test/global-setup.ts"],

    /*
     * ⚠️ Required by any suite that imports a DTO. class-validator and class-transformer read
     * design-time types through `Reflect.getMetadata`, which does not exist until this polyfill
     * is loaded — the app gets it from the first line of main.ts, and tests have no main.ts.
     * Without it the failure is `Reflect.getMetadata is not a function` pointing at a decorator,
     * which reads like a broken decorator rather than a missing global.
     */
    setupFiles: ["reflect-metadata"],

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
