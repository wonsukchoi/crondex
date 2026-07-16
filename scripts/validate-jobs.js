#!/usr/bin/env node
// Validates every jobs/**/*.yaml against schema/job.schema.json.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import Ajv from "ajv";
import { isValidSchedule } from "../lib/cron.js";

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

const schema = JSON.parse(readFileSync(join(ROOT, "schema/job.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

let failed = 0;
const idLocations = new Map();
for (const file of walk(JOBS_DIR)) {
  const doc = yaml.load(readFileSync(file, "utf8"));
  const rel = relative(ROOT, file);
  if (!validate(doc)) {
    for (const err of validate.errors) {
      console.error(`${rel}: ${err.instancePath} ${err.message}`);
    }
    failed++;
    continue;
  }
  const scheduleCheck = isValidSchedule(doc.schedule);
  if (!scheduleCheck.valid) {
    console.error(`${rel}: schedule "${doc.schedule}" is not a valid cron expression — ${scheduleCheck.error}`);
    failed++;
  }
  if (!idLocations.has(doc.id)) idLocations.set(doc.id, []);
  idLocations.get(doc.id).push(rel);
}

for (const [id, files] of idLocations) {
  if (files.length > 1) {
    console.error(`duplicate id "${id}" used by: ${files.join(", ")}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} job(s) failed validation`);
  process.exit(1);
}
console.log("all jobs valid");
