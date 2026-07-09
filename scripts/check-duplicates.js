#!/usr/bin/env node
// Flags pairs of jobs that look like near-duplicates (heavy tag/description
// overlap), so a copy-pasted job doesn't slip in unnoticed next to one that
// already covers the same ground. Not a hard gate on wording similarity —
// two jobs can legitimately share vocabulary (e.g. two different "expiry
// check" jobs) without being duplicates, so this flags for human review
// rather than failing outright on any overlap.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";
import { tokenize, stem } from "../lib/recommend.js";
import { findDuplicates } from "../lib/duplicates.js";

const ROOT = new URL("..", import.meta.url).pathname;
const JOBS_DIR = join(ROOT, "jobs");

// Tune via env vars without editing this file.
const TAG_THRESHOLD = Number(process.env.CRONDEX_DUP_TAG_THRESHOLD) || 0.6;
const DESC_THRESHOLD = Number(process.env.CRONDEX_DUP_DESC_THRESHOLD) || 0.5;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) out.push(full);
  }
  return out;
}

const jobs = walk(JOBS_DIR).map((file) => {
  const doc = yaml.load(readFileSync(file, "utf8"));
  return {
    rel: relative(ROOT, file),
    id: doc.id,
    tags: new Set((doc.tags ?? []).map((t) => stem(t.toLowerCase()))),
    description: new Set(tokenize(doc.description ?? "")),
  };
});

const flagged = findDuplicates(jobs, { tagThreshold: TAG_THRESHOLD, descThreshold: DESC_THRESHOLD });

if (flagged.length > 0) {
  console.error(`${flagged.length} possible near-duplicate job pair(s) — review before merging:\n`);
  for (const { a, b, tagSim, descSim } of flagged) {
    console.error(`  ${a.id}  <->  ${b.id}`);
    console.error(`    ${a.rel}`);
    console.error(`    ${b.rel}`);
    console.error(`    tag overlap: ${tagSim.toFixed(2)}, description overlap: ${descSim.toFixed(2)}\n`);
  }
  console.error(
    "If these are genuinely distinct jobs, this isn't a hard failure — it's just a nudge to double-check " +
      "before merging. Tune via CRONDEX_DUP_TAG_THRESHOLD / CRONDEX_DUP_DESC_THRESHOLD env vars if this " +
      "fires too eagerly."
  );
  process.exit(1);
}

console.log("no near-duplicate jobs found");
