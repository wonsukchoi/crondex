#!/usr/bin/env node
// Validates every jobs/**/*.yaml against schema/job.schema.json.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";
import Ajv from "ajv";

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

const schema = JSON.parse(readFileSync(join(ROOT, "schema/job.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

let failed = 0;
for (const file of walk(JOBS_DIR)) {
  const doc = yaml.load(readFileSync(file, "utf8"));
  const rel = relative(ROOT, file);
  if (doc.runner === "agent-prompt" && !doc.prompt) {
    console.error(`${rel}: runner is agent-prompt but no prompt set`);
    failed++;
  }
  if (doc.runner === "shell" && !doc.command) {
    console.error(`${rel}: runner is shell but no command set`);
    failed++;
  }
  if (!validate(doc)) {
    for (const err of validate.errors) {
      console.error(`${rel}: ${err.instancePath} ${err.message}`);
    }
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} job(s) failed validation`);
  process.exit(1);
}
console.log("all jobs valid");
