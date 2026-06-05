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
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
