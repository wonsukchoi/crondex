#!/usr/bin/env node
// Scans jobs/**/*.yaml and regenerates catalog.json at the repo root.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";
import { CATEGORY_DESCRIPTIONS } from "../lib/category-descriptions.js";

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
      version: doc.version,
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

const byCategory = new Map();
for (const j of jobs) byCategory.set(j.category, (byCategory.get(j.category) ?? 0) + 1);
const categories = [...byCategory.keys()].sort();

const missingDescriptions = categories.filter((c) => !CATEGORY_DESCRIPTIONS[c]);
if (missingDescriptions.length > 0) {
  console.warn(
    `no entry in lib/category-descriptions.js for: ${missingDescriptions.join(", ")} — add one so the README table doesn't show a blank description.`
  );
}

const summaryLines = [
  `${jobs.length} jobs across ${categories.length} categories:`,
  "",
  "| category | jobs | description |",
  "|---|---|---|",
  ...categories.map((c) => `| \`${c}\` | ${byCategory.get(c)} | ${CATEGORY_DESCRIPTIONS[c] ?? ""} |`),
];

const README_PATH = join(ROOT, "README.md");
const readme = readFileSync(README_PATH, "utf8");
const BEGIN = "<!-- BEGIN JOB SUMMARY -->";
const END = "<!-- END JOB SUMMARY -->";
const start = readme.indexOf(BEGIN);
const end = readme.indexOf(END);
if (start === -1 || end === -1) {
  console.warn(`could not find ${BEGIN} / ${END} markers in README.md — skipped summary sync`);
} else {
  const updated =
    readme.slice(0, start + BEGIN.length) +
    "\n" +
    summaryLines.join("\n") +
    "\n" +
    readme.slice(end);
  writeFileSync(README_PATH, updated);
  console.log(`synced README.md job summary (${categories.length} categories)`);
}
