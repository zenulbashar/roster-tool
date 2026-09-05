import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

// Load .env into process.env for local runs (without an extra dependency).
// In CI there is no .env file and the variables are provided directly, so this
// is a no-op there.
const envPath = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    const key = match?.[1];
    const value = match?.[2];
    if (key && value !== undefined && !(key in process.env)) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // TEST-01: coverage of the LOGIC layer (`src/lib`), where the suite runs
    // real code against Postgres. Pages, components and server actions render
    // in a browser and are out of scope here (the ratchet would otherwise be
    // dominated by UI files no unit test can reach). Gate: a checked-in
    // ratchet baseline (scripts/coverage-ratchet.mjs) — rise freely, never
    // fall.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/db/schema.ts"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
