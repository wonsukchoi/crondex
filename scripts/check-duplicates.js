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

const ROOT = new URL("..", import.meta.url).pathname;
const JOBS_DIR = join(ROOT, "jobs");

// A pair is flagged only when BOTH tag and description overlap clear their
// threshold — tag overlap alone false-positives on jobs that just share a
// couple of generic tags (e.g. two intentionally complementary "SLA" jobs),
// and description overlap alone false-positives on jobs following the same
// wording template for genuinely different systems (e.g. "diff X against a
// saved baseline" for both a firewall job and a WAF job). Tune via env vars
// without editing this file.
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

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
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

const flagged = [];
for (let i = 0; i < jobs.length; i++) {
  for (let j = i + 1; j < jobs.length; j++) {
    const a = jobs[i];
    const b = jobs[j];
    const tagSim = jaccard(a.tags, b.tags);
    const descSim = jaccard(a.description, b.description);
    if (tagSim >= TAG_THRESHOLD && descSim >= DESC_THRESHOLD) flagged.push({ a, b, tagSim, descSim });
  }
}

if (flagged.length > 0) {
  flagged.sort((x, y) => y.tagSim + y.descSim - (x.tagSim + x.descSim));
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
