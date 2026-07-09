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
  crondex categories
  crondex show <id>
  crondex add <id> [--dest <path>]
  crondex recommend "<what you want done>" [--limit <n>]
  crondex init <id> [--category <name>] [--dest <path>]

Examples:
  crondex list --category devops
  crondex categories
  crondex show dependency-audit
  crondex add backup-reminder --dest ./cron/backup-reminder.yaml
  crondex recommend "warn me before my SSL cert expires"
  crondex init ssl-cert-expiry-check --category security
`);
}

const STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "in", "on", "at", "by", "and", "or", "my", "me", "i",
  "can", "you", "do", "does", "this", "that", "these", "those", "please", "want", "wants",
  "wanted", "need", "needs", "help", "with", "is", "are", "be", "it", "so", "when", "should",
  "could", "would", "how", "what", "which", "up", "down", "get", "make", "set", "just", "really",
  "some", "something", "any", "want", "us", "our", "your", "yours", "if", "then", "than",
]);

function stem(word) {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && word.endsWith("es") && !word.endsWith("ses")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

// id and name are near-duplicates of each other (id is just the slugified
// name), so they're merged into one "title" field — otherwise a match on a
// shared word like "water" gets weighted 3+3 instead of 3, which can outrank
// a more specific job that only matches once via tags.
const RECOMMEND_WEIGHTS = { tags: 4, title: 3, category: 2, description: 1 };

function scoreJob(queryTokens, job) {
  const fields = {
    tags: job.tags.map((t) => stem(t.toLowerCase())),
    title: [...new Set([...tokenize(job.name), ...tokenize(job.id.replace(/-/g, " "))])],
    category: tokenize(job.category ?? ""),
    description: tokenize(job.description ?? ""),
  };
  let score = 0;
  const matched = new Set();
  for (const qt of queryTokens) {
    for (const [field, weight] of Object.entries(RECOMMEND_WEIGHTS)) {
      if (fields[field].includes(qt)) {
        score += weight;
        matched.add(qt);
      }
    }
  }
  return { score, matchedTerms: [...matched] };
}

function recommend(queryText) {
  const limit = Number(flag("limit")) || 5;
  const queryTokens = tokenize(queryText);
  if (!queryTokens.length) {
    console.log("query too vague to match on — describe what you want the job to check or remind you about.");
    return;
  }
  const ranked = CATALOG.jobs
    .map((job) => ({ job, ...scoreJob(queryTokens, job) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (!ranked.length) {
    console.log(`no confident match for "${queryText}". Run "crondex list" to browse everything.`);
    return;
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

function categories() {
  const counts = {};
  for (const j of CATALOG.jobs) counts[j.category] = (counts[j.category] ?? 0) + 1;
  console.log(catalogInfoLine());
  console.log();
  for (const [cat, n] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${cat}  (${n})`);
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
  default:
    printHelp();
}
