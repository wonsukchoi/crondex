#!/usr/bin/env node
// Fails if any category in catalog.json has fewer than FLOOR jobs, so the
// directory doesn't end up with a handful of thin, barely-populated
// categories next to well-stocked ones. Run `npm run build-catalog` first if
// you've added/removed job files — this reads catalog.json, not jobs/ directly.
import { readFileSync } from "node:fs";

const CATALOG_PATH = new URL("../catalog.json", import.meta.url);

const FLOOR = Number(process.env.CRONDEX_CATEGORY_FLOOR) || 32;

const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));

const counts = new Map();
for (const job of catalog.jobs) {
  counts.set(job.category, (counts.get(job.category) ?? 0) + 1);
}

const offenders = [...counts.entries()]
  .filter(([, count]) => count < FLOOR)
  .sort((a, b) => a[1] - b[1]);

if (offenders.length > 0) {
  console.error(`${offenders.length} categor${offenders.length === 1 ? "y is" : "ies are"} below the floor of ${FLOOR} job(s):\n`);
  for (const [category, count] of offenders) {
    console.error(`  ${category}: ${count} job(s), needs ${FLOOR - count} more`);
  }
  console.error(
    "\nAdd job(s) to the category folder(s) above (see CONTRIBUTING.md), then re-run " +
      "'npm run build-catalog' and this check. Tune the floor via CRONDEX_CATEGORY_FLOOR."
  );
  process.exit(1);
}

console.log(`all ${counts.size} categories meet the floor of ${FLOOR} job(s)`);
