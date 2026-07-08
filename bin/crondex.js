#!/usr/bin/env node
// CLI over catalog.json — browse jobs, read one, or pull one into your project.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CATALOG = JSON.parse(readFileSync(join(ROOT, "catalog.json"), "utf8"));
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const [, , cmd, ...args] = process.argv;

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

function findJob(id) {
  const meta = CATALOG.jobs.find((j) => j.id === id);
  if (!meta) {
    console.error(`no job named "${id}". Run "crondex list" to see options.`);
    process.exit(1);
  }
  return meta;
}

function printHelp() {
  console.log(`crondex — browse and pull pre-made cron jobs

Usage:
  crondex list [--category <name>] [--tag <name>]
  crondex show <id>
  crondex add <id> [--dest <path>]

Examples:
  crondex list --category devops
  crondex show dependency-audit
  crondex add backup-reminder --dest ./cron/backup-reminder.yaml
`);
}

function catalogInfoLine() {
  const viaNpx = process.env.npm_command === "exec";
  const freshness = viaNpx
    ? "running via npx — you're always on the latest catalog."
    : `running from a local/global install — run \`npm update -g ${PKG.name}\` (or re-pull) if new jobs seem missing.`;
  return `crondex v${PKG.version} — ${CATALOG.count} jobs. ${freshness}`;
}

function list() {
  const category = flag("category");
  const tag = flag("tag");
  const jobs = CATALOG.jobs.filter(
    (j) => (!category || j.category === category) && (!tag || j.tags.includes(tag))
  );
  console.log(catalogInfoLine());
  console.log();
  if (!jobs.length) {
    console.log("no jobs matched.");
    return;
  }
  for (const j of jobs) {
    console.log(`${j.id}  [${j.category}]  (${j.modes.join(", ")})`);
    console.log(`  ${j.description}`);
    console.log();
  }
}

function show(id) {
  console.log(readFileSync(join(ROOT, findJob(id).path), "utf8"));
}

function add(id) {
  const meta = findJob(id);
  const dest = flag("dest") ?? `./${id}.yaml`;
  if (existsSync(dest)) {
    console.error(`${dest} already exists — refusing to overwrite. Pass --dest to choose another path.`);
    process.exit(1);
  }
  writeFileSync(dest, readFileSync(join(ROOT, meta.path), "utf8"));
  console.log(`wrote ${dest}`);
}

switch (cmd) {
  case "list":
    list();
    break;
  case "show":
    if (!args[0]) {
      console.error("usage: crondex show <id>");
      process.exit(1);
    }
    show(args[0]);
    break;
  case "add":
    if (!args[0]) {
      console.error("usage: crondex add <id> [--dest <path>]");
      process.exit(1);
    }
    add(args[0]);
    break;
  default:
    printHelp();
}
