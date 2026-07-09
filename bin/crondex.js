#!/usr/bin/env node
// CLI over catalog.json — browse jobs, read one, or pull one into your project.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";
import { tokenize, rankJobs } from "../lib/recommend.js";
import { CATEGORY_DESCRIPTIONS } from "../lib/category-descriptions.js";
import { resolveVariables, substitutePlaceholders, pickMode, buildCrontabLine, buildGithubActionsWorkflow } from "../lib/deploy.js";

const ROOT = new URL("..", import.meta.url).pathname;
const CATALOG = JSON.parse(readFileSync(join(ROOT, "catalog.json"), "utf8"));
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const [, , cmd, ...args] = process.argv;

function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

// Collects every `--var name=value` occurrence (the flag can repeat).
function varOverrides() {
  const overrides = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--var") continue;
    const pair = args[i + 1] ?? "";
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    overrides[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return overrides;
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
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
  crondex list [--category <name>] [--tag <name>] [--json]
  crondex categories [--json]
  crondex show <id> [--json]
  crondex add <id> [--dest <path>]
  crondex recommend "<what you want done>" [--limit <n>] [--json]
  crondex init <id> [--category <name>] [--dest <path>]
  crondex deploy <id> [--target crontab|github-actions] [--mode script|prompt]
                      [--var name=value ...] [--dest <path>] [--install]

Examples:
  crondex list --category devops
  crondex categories
  crondex show dependency-audit
  crondex add backup-reminder --dest ./cron/backup-reminder.yaml
  crondex recommend "warn me before my SSL cert expires"
  crondex init ssl-cert-expiry-check --category security
  crondex deploy ssl-cert-expiry-check --var host=example.com --var port=443
  crondex deploy repo-health-check --target github-actions

Add --json to list/categories/show/recommend for machine-readable output —
useful when an agent is parsing crondex's output programmatically instead
of a human reading it.

deploy turns a job into something you can actually run: --target crontab
(default) prints a ready crontab line, or installs it into your own
crontab with --install; --target github-actions writes a scheduled
workflow file (default .github/workflows/<id>.yml). --var overrides a
job's variable defaults (repeatable). hybrid jobs default to --mode script
(zero tokens); pass --mode prompt to deploy the agent-prompt side instead.
`);
}

function recommend(queryText) {
  const limit = Number(flag("limit")) || 5;
  const json = hasFlag("json");
  if (!tokenize(queryText).length) {
    if (json) return printJson([]);
    console.log("query too vague to match on — describe what you want the job to check or remind you about.");
    return;
  }
  const ranked = rankJobs(CATALOG.jobs, queryText, limit);
  if (!ranked.length) {
    if (json) return printJson([]);
    console.log(`no confident match for "${queryText}". Run "crondex list" to browse everything.`);
    return;
  }
  if (json) {
    return printJson(
      ranked.map((r) => ({
        id: r.job.id,
        category: r.job.category,
        score: r.score,
        matched_terms: r.matchedTerms,
        modes: r.job.modes,
        description: r.job.description,
      }))
    );
  }
  console.log(`top match${ranked.length > 1 ? "es" : ""} for "${queryText}":`);
  console.log();
  for (const r of ranked) {
    console.log(`${r.job.id}  [${r.job.category}]  score ${r.score}  (${r.job.modes.join(", ")})`);
    console.log(`  ${r.job.description}`);
    console.log(`  matched: ${r.matchedTerms.join(", ")}`);
    console.log();
  }
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
  const json = hasFlag("json");
  const jobs = CATALOG.jobs.filter(
    (j) => (!category || j.category === category) && (!tag || j.tags.includes(tag))
  );
  if (json) return printJson(jobs);
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
  const meta = findJob(id);
  const raw = readFileSync(join(ROOT, meta.path), "utf8");
  if (hasFlag("json")) return printJson(yaml.load(raw));
  console.log(raw);
}

function categories() {
  const counts = {};
  for (const j of CATALOG.jobs) counts[j.category] = (counts[j.category] ?? 0) + 1;
  const sorted = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (hasFlag("json")) {
    return printJson(
      sorted.map(([category, count]) => ({ category, count, description: CATEGORY_DESCRIPTIONS[category] ?? "" }))
    );
  }
  console.log(catalogInfoLine());
  console.log();
  for (const [cat, n] of sorted) {
    console.log(`${cat}  (${n})`);
    if (CATEGORY_DESCRIPTIONS[cat]) console.log(`  ${CATEGORY_DESCRIPTIONS[cat]}`);
  }
}

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function init(id) {
  if (!ID_RE.test(id)) {
    console.error(`"${id}" isn't a valid job id — use lowercase letters, digits, and hyphens (e.g. ssl-cert-expiry-check).`);
    process.exit(1);
  }
  const category = flag("category") ?? "productivity";
  const dest = flag("dest") ?? `./${id}.yaml`;
  if (existsSync(dest)) {
    console.error(`${dest} already exists — refusing to overwrite. Pass --dest to choose another path.`);
    process.exit(1);
  }
  const template = readFileSync(join(ROOT, "templates/job.template.yaml"), "utf8")
    .replace("id: your-job-id", `id: ${id}`)
    .replace("category: devops", `category: ${category}`);
  writeFileSync(dest, template);
  console.log(`wrote ${dest} — fill in the fields, then \`npm run validate\` (see CONTRIBUTING.md to submit it upstream).`);
}

function installCrontabLine(id, line) {
  let existing = "";
  try {
    existing = execFileSync("crontab", ["-l"], { encoding: "utf8" });
  } catch {
    existing = "";
  }
  const marker = `# crondex:${id}`;
  const kept = existing
    .split("\n")
    .filter((l) => l.trim().length > 0 && !l.includes(marker));
  const updated = [...kept, line].join("\n") + "\n";
  execFileSync("crontab", ["-"], { input: updated });
}

function deploy(id) {
  const meta = findJob(id);
  const doc = yaml.load(readFileSync(join(ROOT, meta.path), "utf8"));
  doc.path = meta.path;
  const target = flag("target") ?? "crontab";
  const mode = pickMode(doc, flag("mode"));

  if (mode === "prompt" && !doc.prompt) {
    console.error(`"${id}" has no prompt to deploy (runner: ${doc.runner}). Try without --mode prompt.`);
    process.exit(1);
  }
  if (mode === "script" && !doc.command) {
    console.error(`"${id}" has no command to deploy (runner: ${doc.runner}). Try --mode prompt.`);
    process.exit(1);
  }

  const values = resolveVariables(doc, varOverrides());
  const command = doc.command ? substitutePlaceholders(doc.command, values) : undefined;
  const prompt = doc.prompt ? substitutePlaceholders(doc.prompt, values) : undefined;

  if (target === "crontab") {
    const line = buildCrontabLine(doc, mode === "prompt" ? prompt : command, mode === "prompt");
    if (hasFlag("install")) {
      installCrontabLine(id, line);
      console.log(`installed into your crontab (replacing any previous "${id}" entry):`);
      console.log(line);
    } else {
      console.log(line);
    }
  } else if (target === "github-actions") {
    const workflow = buildGithubActionsWorkflow(doc, { command, prompt, mode });
    const dest = flag("dest") ?? join(".github/workflows", `${id}.yml`);
    if (existsSync(dest)) {
      console.error(`${dest} already exists — refusing to overwrite. Pass --dest to choose another path.`);
      process.exit(1);
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, workflow);
    console.log(`wrote ${dest}`);
  } else {
    console.error(`unknown --target "${target}" — use "crontab" or "github-actions".`);
    process.exit(1);
  }
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
  case "categories":
    categories();
    break;
  case "init":
    if (!args[0]) {
      console.error("usage: crondex init <id> [--category <name>] [--dest <path>]");
      process.exit(1);
    }
    init(args[0]);
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
  case "recommend":
    if (!args[0]) {
      console.error('usage: crondex recommend "<what you want done>" [--limit <n>]');
      process.exit(1);
    }
    recommend(args[0]);
    break;
  case "deploy":
    if (!args[0]) {
      console.error("usage: crondex deploy <id> [--target crontab|github-actions] [--mode script|prompt] [--var name=value ...] [--dest <path>] [--install]");
      process.exit(1);
    }
    deploy(args[0]);
    break;
  default:
    printHelp();
}
