#!/usr/bin/env node
// Scans jobs/**/*.yaml and regenerates catalog.json at the repo root.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { CATEGORY_DESCRIPTIONS } from "../lib/category-descriptions.js";
import {
  modesForRunner,
  findMissingDescriptions,
  buildSummaryLines,
  spliceReadmeSummary,
  spliceMarkedSection,
  buildRoadmapStatsLine,
} from "../lib/catalog-summary.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JOBS_DIR = join(ROOT, "jobs");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) out.push(full);
  }
  return out;
}

const jobs = walk(JOBS_DIR)
  .map((file) => {
    const doc = yaml.load(readFileSync(file, "utf8"));
    return {
      id: doc.id,
      version: doc.version,
      name: doc.name,
      description: doc.description?.trim(),
      category: doc.category,
      tags: doc.tags ?? [],
      schedule: doc.schedule,
      timezone: doc.timezone ?? null,
      runner: doc.runner,
      modes: modesForRunner(doc.runner),
      compatible_agents: doc.compatible_agents ?? [],
      path: relative(ROOT, file),
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const catalog = {
  generated_by: "scripts/build-catalog.js",
  schema: "schema/job.schema.json",
  count: jobs.length,
  jobs,
};

writeFileSync(join(ROOT, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
console.log(`wrote catalog.json with ${jobs.length} jobs`);

const categories = [...new Set(jobs.map((j) => j.category))].sort();

const missingDescriptions = findMissingDescriptions(categories, CATEGORY_DESCRIPTIONS);
if (missingDescriptions.length > 0) {
  console.warn(
    `no entry in lib/category-descriptions.js for: ${missingDescriptions.join(", ")} — add one so the README table doesn't show a blank description.`
  );
}

const summaryLines = buildSummaryLines(jobs, CATEGORY_DESCRIPTIONS);

const README_PATH = join(ROOT, "README.md");
const readme = readFileSync(README_PATH, "utf8");
const updated = spliceReadmeSummary(readme, summaryLines);
if (updated === null) {
  console.warn("could not find BEGIN/END JOB SUMMARY markers in README.md — skipped summary sync");
} else {
  writeFileSync(README_PATH, updated);
  console.log(`synced README.md job summary (${categories.length} categories)`);
}

const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const ROADMAP_PATH = join(ROOT, "ROADMAP.md");
const roadmap = readFileSync(ROADMAP_PATH, "utf8");
const statsLine = buildRoadmapStatsLine(jobs, categories.length, PKG.version);
const updatedRoadmap = spliceMarkedSection(roadmap, "<!-- BEGIN CATALOG STATS -->", "<!-- END CATALOG STATS -->", [
  statsLine,
]);
if (updatedRoadmap === null) {
  console.warn("could not find BEGIN/END CATALOG STATS markers in ROADMAP.md — skipped stats sync");
} else {
  writeFileSync(ROADMAP_PATH, updatedRoadmap);
  console.log(`synced ROADMAP.md catalog stats (${jobs.length} jobs, ${categories.length} categories)`);
}
