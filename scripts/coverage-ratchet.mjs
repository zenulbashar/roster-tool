#!/usr/bin/env node
/**
 * Coverage RATCHET (TEST-01): coverage may rise freely and must never fall.
 *
 * Reads the totals vitest wrote to coverage/coverage-summary.json and compares
 * them with the checked-in coverage-baseline.json. A metric that drops by more
 * than the noise tolerance fails the build; a metric that rose is reported so
 * the baseline can be bumped. There is deliberately NO absolute target — a
 * target invites gaming, a ratchet only stops regression.
 *
 *   npm run test:coverage && npm run coverage:ratchet             # check
 *   npm run test:coverage && npm run coverage:ratchet -- --update # lock in
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import console from "node:console";
import process from "node:process";

const SUMMARY = "coverage/coverage-summary.json";
const BASELINE = "coverage-baseline.json";
const METRICS = ["lines", "statements", "functions", "branches"];
/** Percentage points a metric may dip before it counts as a regression. */
const TOLERANCE = 0.25;

if (!existsSync(SUMMARY)) {
  console.error(
    `${SUMMARY} not found — run \`npm run test:coverage\` first (vitest --coverage).`,
  );
  process.exit(2);
}

const total = JSON.parse(readFileSync(SUMMARY, "utf8")).total;
const current = Object.fromEntries(
  METRICS.map((m) => [m, Number(total[m].pct.toFixed(2))]),
);

if (process.argv.includes("--update")) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Wrote ${BASELINE}:`, current);
  process.exit(0);
}

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, "utf8"))
  : {};

let dropped = false;
let rose = false;
for (const m of METRICS) {
  const base = Number(baseline[m] ?? 0);
  const now = current[m];
  let status = "ok";
  if (now + TOLERANCE < base) {
    status = "DROPPED";
    dropped = true;
  } else if (now > base + 1) {
    status = "up";
    rose = true;
  }
  console.log(
    `${m.padEnd(11)} ${now.toFixed(2).padStart(6)}%  (baseline ${base.toFixed(2)}%)  ${status}`,
  );
}

if (dropped) {
  console.error(
    "\nCoverage fell below the ratchet baseline. Add tests for what you changed — or, if the drop is deliberate and reviewed, run `npm run coverage:ratchet -- --update` and commit coverage-baseline.json.",
  );
  process.exit(1);
}
if (rose) {
  console.log(
    "\nCoverage rose by more than a point: run `npm run coverage:ratchet -- --update` to lock the gain in.",
  );
}
