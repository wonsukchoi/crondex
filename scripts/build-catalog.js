#!/usr/bin/env node
// Scans jobs/**/*.yaml and regenerates catalog.json at the repo root.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";

const ROOT = new URL("..", import.meta.url).pathname;
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

const MODES_BY_RUNNER = {
  "agent-prompt": ["agent-prompt"],
  shell: ["script"],
  hybrid: ["script", "agent-prompt"],
};

const jobs = walk(JOBS_DIR)
  .map((file) => {
    const doc = yaml.load(readFileSync(file, "utf8"));
    return {
      id: doc.id,
      name: doc.name,
      description: doc.description?.trim(),
      category: doc.category,
      tags: doc.tags ?? [],
      schedule: doc.schedule,
      timezone: doc.timezone ?? null,
      runner: doc.runner,
      modes: MODES_BY_RUNNER[doc.runner] ?? [],
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
