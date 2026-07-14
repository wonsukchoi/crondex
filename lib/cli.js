// CLI over catalog.json — argument parsing + command routing, extracted out of
// bin/crondex.js so both pieces (parser, dispatch table) are unit-testable in
// isolation from the integration tests in test/cli.test.js (which still spawn
// bin/crondex.js as a subprocess and exercise this module end-to-end).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";
import { tokenize, rankJobs } from "./recommend.js";
import { CATEGORY_DESCRIPTIONS } from "./category-descriptions.js";
import {
  resolveVariables,
  substitutePlaceholders,
  pickMode,
  buildCrontabLine,
  buildGithubActionsWorkflow,
  buildSystemdUnits,
  buildDockerArtifacts,
  buildK8sCronJob,
  buildEventBridgeCommand,
  buildCloudSchedulerCommand,
} from "./deploy.js";
import { formatDiff } from "./diff.js";
import { nextRuns } from "./cron.js";
import { auditInstalled } from "./doctor.js";
import { runBundle } from "./bundle.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CATALOG = JSON.parse(readFileSync(join(ROOT, "catalog.json"), "utf8"));
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// --- argument parsing -------------------------------------------------------

// Parses a full argv (minus `node script.js`, i.e. [command, ...rest]) into
// {command, positional, flags}. `--name value` becomes flags.name = "value";
// a `--name` with nothing after it (or immediately followed by another `--flag`)
// becomes a boolean flags.name = true. `--var k=v` is special-cased and can
// repeat — occurrences accumulate into flags.var = {k: v, ...}. Everything else
// that isn't consumed as a flag/flag-value is collected into `positional`, in
// order.
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const vars = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === "--var") {
      const pair = rest[i + 1] ?? "";
      i++;
      const eq = pair.indexOf("=");
      if (eq !== -1) vars[pair.slice(0, eq)] = pair.slice(eq + 1);
      continue;
    }
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
      continue;
    }
    positional.push(token);
  }
  if (Object.keys(vars).length > 0) flags.var = vars;
  return { command, positional, flags };
}

function flagVal(flags, name) {
  const v = flags[name];
  return v === true ? undefined : v;
}

function hasFlagVal(flags, name) {
  return name in flags;
}

function varOverridesVal(flags) {
  return flags.var ?? {};
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
  crondex next <id> [--count <n>] [--json]
  crondex add <id> [--dest <path>]
  crondex recommend "<what you want done>" [--limit <n>] [--json]
  crondex init <id> [--category <name>] [--dest <path>]
  crondex update <path> [--dry-run]
  crondex deploy <id> [--target crontab|github-actions|systemd|docker|k8s-cronjob|
                                 eventbridge|cloud-scheduler] [--mode script|prompt]
                      [--var name=value ...] [--dest <path>] [--install]
  crondex deploy --list-installed [--json]
  crondex uninstall <id>
  crondex doctor [--json]
  crondex bundle <file.yaml> [--target crontab|github-actions|systemd|docker|k8s-cronjob|
                                        eventbridge|cloud-scheduler] [--dry-run]
                             [--out-dir <path>] [--install]
  crondex mcp [--allow-deploy]

Examples:
  crondex list --category devops
  crondex categories
  crondex show dependency-audit
  crondex next dependency-audit
  crondex next dependency-audit --count 3 --json
  crondex add backup-reminder --dest ./cron/backup-reminder.yaml
  crondex recommend "warn me before my SSL cert expires"
  crondex init ssl-cert-expiry-check --category security
  crondex update ./cron/backup-reminder.yaml
  crondex update ./cron/backup-reminder.yaml --dry-run
  crondex deploy ssl-cert-expiry-check --var host=example.com --var port=443
  crondex deploy repo-health-check --target github-actions
  crondex deploy repo-health-check --target systemd --dest ./systemd
  crondex deploy repo-health-check --target docker --dest ./docker/repo-health-check
  crondex deploy repo-health-check --target k8s-cronjob --dest ./k8s/repo-health-check.yaml
  crondex deploy repo-health-check --target eventbridge
  crondex deploy repo-health-check --target cloud-scheduler
  crondex deploy --list-installed
  crondex uninstall ssl-cert-expiry-check
  crondex doctor
  crondex bundle ./cron/bundle.yaml --target crontab
  crondex mcp
  crondex mcp --allow-deploy

mcp starts crondex as an MCP server over stdio, exposing recommend/list/
categories/show/next as tools (crondex_recommend, crondex_list,
crondex_categories, crondex_show, crondex_next_runs) — read-only, no
filesystem writes, no crontab access. Pass --allow-deploy to also register
crondex_deploy, a tool that generates (but never writes or installs) a
deployment artifact for a job. Configure your MCP client to run
\`npx -y ${PKG.name} mcp\`. See the README for client config snippets.

next prints the next N run times (default 5) for a job's schedule, in its
declared timezone (or your system timezone if the job doesn't set one) —
useful to sanity-check a schedule before deploying it. Zero tokens, no
network call.

Add --json to list/categories/show/recommend/next for machine-readable output —
useful when an agent is parsing crondex's output programmatically instead
of a human reading it.

deploy turns a job into something you can actually run: --target crontab
(default) prints a ready crontab line, or installs it into your own
crontab with --install; --target github-actions writes a scheduled
workflow file (default .github/workflows/<id>.yml); --target systemd
writes a <id>.service + <id>.timer pair (default ./systemd/); --target
docker writes a Dockerfile + crontab pair that runs the job on its own
schedule in a container (default ./docker/<id>/); --target k8s-cronjob
writes a self-contained batch/v1 CronJob manifest (default
./k8s/<id>.cronjob.yaml). --target eventbridge and --target
cloud-scheduler print a ready aws/gcloud CLI command instead — those
services invoke a target (Lambda/ECS/HTTP endpoint) rather than running a
shell command directly, so the command leaves that target as a TODO for
you to wire up. --var overrides a job's variable defaults (repeatable).
hybrid jobs default to --mode script (zero tokens); pass --mode prompt to
deploy the agent-prompt side instead.

deploy --list-installed shows every crondex-managed line in your crontab
(the ones with a "# crondex:<id>" marker, as left by --install). uninstall
removes one of those by id.

update re-pulls a job you already added/inited (matched by its "id" field)
against the current catalog, prints a diff of what changed, and overwrites
the local file in place. Pass --dry-run to see the diff without applying it.

doctor audits your installed crontab entries against the catalog: flags
orphaned entries (job id no longer in the catalog), schedule drift (the
installed schedule no longer matches the catalog's), and entries installed
before version tagging or older than the catalog's current version
(redeploy to tag/update them). Exits 0 if everything's healthy, 1 if any
issues were found.

bundle deploys every job listed in a manifest file in one shot — see the
README's "Bundles" section for the manifest format. --dry-run prints the
combined output without installing/writing anything; --out-dir writes one
file (or file pair, for systemd/docker) per job instead of printing;
--install (crontab target only) installs every job into your crontab.
`);
}

function recommend(queryText, flags) {
  const limit = Number(flagVal(flags, "limit")) || 5;
  const json = hasFlagVal(flags, "json");
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

function list(flags) {
  const category = flagVal(flags, "category");
  const tag = flagVal(flags, "tag");
  const json = hasFlagVal(flags, "json");
  const jobs = CATALOG.jobs.filter((j) => (!category || j.category === category) && (!tag || j.tags.includes(tag)));
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

function show(id, flags) {
  const meta = findJob(id);
  const raw = readFileSync(join(ROOT, meta.path), "utf8");
  if (hasFlagVal(flags, "json")) return printJson(yaml.load(raw));
  console.log(raw);
}

function categories(flags) {
  const counts = {};
  for (const j of CATALOG.jobs) counts[j.category] = (counts[j.category] ?? 0) + 1;
  const sorted = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  if (hasFlagVal(flags, "json")) {
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

function init(id, flags) {
  if (!ID_RE.test(id)) {
    console.error(
      `"${id}" isn't a valid job id — use lowercase letters, digits, and hyphens (e.g. ssl-cert-expiry-check).`
    );
    process.exit(1);
  }
  const category = flagVal(flags, "category") ?? "productivity";
  const dest = flagVal(flags, "dest") ?? `./${id}.yaml`;
  if (existsSync(dest)) {
    console.error(`${dest} already exists — refusing to overwrite. Pass --dest to choose another path.`);
    process.exit(1);
  }
  const template = readFileSync(join(ROOT, "templates/job.template.yaml"), "utf8")
    .replace("id: your-job-id", `id: ${id}`)
    .replace("category: devops", `category: ${category}`);
  writeFileSync(dest, template);
  console.log(
    `wrote ${dest} — fill in the fields, then \`npm run validate\` (see CONTRIBUTING.md to submit it upstream).`
  );
}

function readCrontab() {
  try {
    return execFileSync("crontab", ["-l"], { encoding: "utf8" });
  } catch {
    return "";
  }
}

function installCrontabLine(id, line) {
  const marker = `# crondex:${id}`;
  const kept = readCrontab()
    .split("\n")
    .filter((l) => l.trim().length > 0 && !l.includes(marker));
  const updated = [...kept, line].join("\n") + "\n";
  execFileSync("crontab", ["-"], { input: updated });
}

function uninstall(id) {
  const marker = `# crondex:${id}`;
  const existing = readCrontab();
  if (!existing.includes(marker)) {
    console.error(
      `no installed crontab entry for "${id}" — run "crondex deploy --list-installed" to see what's there.`
    );
    process.exit(1);
  }
  const kept = existing.split("\n").filter((l) => l.trim().length > 0 && !l.includes(marker));
  execFileSync("crontab", ["-"], { input: kept.join("\n") + "\n" });
  console.log(`removed "${id}" from your crontab.`);
}

function listInstalled(flags) {
  const managed = readCrontab()
    .split("\n")
    .filter((l) => l.includes("# crondex:"));
  if (hasFlagVal(flags, "json")) {
    return printJson(managed.map((l) => ({ id: l.match(/# crondex:(\S+)/)?.[1], line: l })));
  }
  if (!managed.length) {
    console.log("no crondex-managed crontab entries installed.");
    return;
  }
  for (const l of managed) console.log(l);
}

function update(path, flags) {
  if (!existsSync(path)) {
    console.error(`${path} does not exist.`);
    process.exit(1);
  }
  const localRaw = readFileSync(path, "utf8");
  let localDoc;
  try {
    localDoc = yaml.load(localRaw);
  } catch (e) {
    console.error(`${path} isn't valid YAML: ${e.message}`);
    process.exit(1);
  }
  if (!localDoc?.id) {
    console.error(`${path} has no "id" field — can't match it to a catalog job.`);
    process.exit(1);
  }
  const meta = findJob(localDoc.id);
  const latestRaw = readFileSync(join(ROOT, meta.path), "utf8");
  const diff = formatDiff(localRaw, latestRaw);
  if (!diff) {
    console.log(`${path} is already up to date with "${localDoc.id}".`);
    return;
  }
  console.log(diff);
  console.log();
  if (hasFlagVal(flags, "dry-run")) {
    console.log(`${path} differs from the catalog (shown above) — rerun without --dry-run to apply.`);
    return;
  }
  writeFileSync(path, latestRaw);
  console.log(`updated ${path} to the latest "${localDoc.id}" from the catalog.`);
}

function deploy(id, flags) {
  if (id === undefined && hasFlagVal(flags, "list-installed")) return listInstalled(flags);
  const meta = findJob(id);
  const doc = yaml.load(readFileSync(join(ROOT, meta.path), "utf8"));
  doc.path = meta.path;
  const target = flagVal(flags, "target") ?? "crontab";
  const mode = pickMode(doc, flagVal(flags, "mode"));

  if (mode === "prompt" && !doc.prompt) {
    console.error(`"${id}" has no prompt to deploy (runner: ${doc.runner}). Try without --mode prompt.`);
    process.exit(1);
  }
  if (mode === "script" && !doc.command) {
    console.error(`"${id}" has no command to deploy (runner: ${doc.runner}). Try --mode prompt.`);
    process.exit(1);
  }

  const values = resolveVariables(doc, varOverridesVal(flags));
  const command = doc.command ? substitutePlaceholders(doc.command, values) : undefined;
  const prompt = doc.prompt ? substitutePlaceholders(doc.prompt, values) : undefined;

  if (target === "crontab") {
    const line = buildCrontabLine(doc, mode === "prompt" ? prompt : command, mode === "prompt");
    if (hasFlagVal(flags, "install")) {
      installCrontabLine(id, line);
      console.log(`installed into your crontab (replacing any previous "${id}" entry):`);
      console.log(line);
    } else {
      console.log(line);
    }
  } else if (target === "github-actions") {
    const workflow = buildGithubActionsWorkflow(doc, { command, prompt, mode });
    const dest = flagVal(flags, "dest") ?? join(".github/workflows", `${id}.yml`);
    writeArtifacts([[dest, workflow]], `wrote ${dest}`);
  } else if (target === "systemd") {
    const { service, timer } = buildSystemdUnits(doc, mode === "prompt" ? prompt : command, mode === "prompt");
    const destDir = flagVal(flags, "dest") ?? "./systemd";
    const serviceDest = join(destDir, `${id}.service`);
    const timerDest = join(destDir, `${id}.timer`);
    writeArtifacts(
      [
        [serviceDest, service],
        [timerDest, timer],
      ],
      `wrote ${serviceDest} and ${timerDest} — enable with:\n  systemctl --user enable --now ${id}.timer`
    );
  } else if (target === "k8s-cronjob") {
    const manifest = buildK8sCronJob(doc, mode === "prompt" ? prompt : command, mode === "prompt");
    const dest = flagVal(flags, "dest") ?? join("./k8s", `${id}.cronjob.yaml`);
    writeArtifacts([[dest, manifest]], `wrote ${dest} — apply with:\n  kubectl apply -f ${dest}`);
  } else if (target === "eventbridge") {
    console.log(buildEventBridgeCommand(doc, mode === "prompt" ? prompt : command, mode === "prompt"));
  } else if (target === "cloud-scheduler") {
    console.log(buildCloudSchedulerCommand(doc, mode === "prompt" ? prompt : command, mode === "prompt"));
  } else if (target === "docker") {
    const { dockerfile, crontab } = buildDockerArtifacts(doc, mode === "prompt" ? prompt : command, mode === "prompt");
    const destDir = flagVal(flags, "dest") ?? join("./docker", id);
    const dockerfileDest = join(destDir, "Dockerfile");
    const crontabDest = join(destDir, "crontab");
    writeArtifacts(
      [
        [dockerfileDest, dockerfile],
        [crontabDest, crontab],
      ],
      `wrote ${dockerfileDest} and ${crontabDest} — build with:\n  docker build -t ${id} ${destDir}`
    );
  } else {
    console.error(
      `unknown --target "${target}" — use "crontab", "github-actions", "systemd", "docker", "k8s-cronjob", "eventbridge", or "cloud-scheduler".`
    );
    process.exit(1);
  }
}

function next(id, flags) {
  const meta = findJob(id);
  const doc = yaml.load(readFileSync(join(ROOT, meta.path), "utf8"));
  const timezone = doc.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const count = Number(flagVal(flags, "count")) || 5;
  let runs;
  try {
    runs = nextRuns(doc.schedule, { timezone, count });
  } catch (e) {
    console.error(`can't compute next runs for "${id}": ${e.message}`);
    process.exit(1);
  }
  if (hasFlagVal(flags, "json")) {
    return printJson({ id, schedule: doc.schedule, timezone, runs: runs.map((d) => d.toISOString()) });
  }
  console.log(`next ${runs.length} run(s) of "${id}" (${doc.schedule}, ${timezone}):`);
  for (const d of runs) {
    console.log(`  ${d.toLocaleString("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" })}`);
  }
}

// Shared by every deploy target that writes one or more files to disk: refuses to
// overwrite an existing file, creates the destination directory(ies), writes every
// file, then prints successMsg. `files` is an array of [path, content] pairs.
function writeArtifacts(files, successMsg) {
  const clash = files.find(([path]) => existsSync(path));
  if (clash) {
    const paths = files.map(([path]) => path).join(" or ");
    const noun = files.length > 1 ? "directory" : "path";
    console.error(`${paths} already exists — refusing to overwrite. Pass --dest to choose another ${noun}.`);
    process.exit(1);
  }
  for (const [path] of files) mkdirSync(dirname(path), { recursive: true });
  for (const [path, content] of files) writeFileSync(path, content);
  console.log(successMsg);
}

function add(id, flags) {
  const meta = findJob(id);
  const dest = flagVal(flags, "dest") ?? `./${id}.yaml`;
  if (existsSync(dest)) {
    console.error(`${dest} already exists — refusing to overwrite. Pass --dest to choose another path.`);
    process.exit(1);
  }
  writeFileSync(dest, readFileSync(join(ROOT, meta.path), "utf8"));
  console.log(`wrote ${dest}`);
}

function doctor(flags) {
  const managed = readCrontab()
    .split("\n")
    .filter((l) => l.includes("# crondex:"));
  const report = auditInstalled(managed, CATALOG.jobs);
  if (hasFlagVal(flags, "json")) {
    printJson(report);
  } else if (!report.length) {
    console.log("all installed crondex-managed crontab entries are healthy.");
  } else {
    for (const entry of report) {
      console.log(`${entry.id}  [${entry.issues.join(", ")}]`);
      console.log(`  ${entry.line}`);
      if (entry.detail) console.log(`  ${entry.detail}`);
      console.log();
    }
    console.log(`${report.length} issue(s) found.`);
  }
  process.exitCode = report.length ? 1 : 0;
}

function bundle(path, flags) {
  if (!existsSync(path)) {
    console.error(`${path} does not exist.`);
    process.exit(1);
  }
  let manifest;
  try {
    manifest = yaml.load(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`${path} isn't valid YAML: ${e.message}`);
    process.exit(1);
  }
  const target = flagVal(flags, "target") ?? "crontab";
  const outDir = flagVal(flags, "out-dir");
  const dryRun = hasFlagVal(flags, "dry-run");

  let result;
  try {
    result = runBundle(manifest, CATALOG, {
      target,
      readJobFile: (jobPath) => readFileSync(join(ROOT, jobPath), "utf8"),
    });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (dryRun) {
    console.log(result.output);
    return;
  }

  if (target === "crontab") {
    if (hasFlagVal(flags, "install")) {
      for (const { id, line } of result.entries) installCrontabLine(id, line);
      console.log(`installed ${result.entries.length} job(s) from ${path} into your crontab.`);
    } else {
      console.log(result.output);
    }
    return;
  }

  if (outDir) {
    for (const file of result.files) {
      const dest = join(outDir, file.name);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, file.content);
    }
    console.log(`wrote ${result.files.length} file(s) to ${outDir}`);
  } else {
    console.log(result.output);
  }
}

// --- command dispatch --------------------------------------------------------

function usageError(message) {
  console.error(message);
  process.exit(1);
}

export const COMMANDS = {
  list: (positional, flags) => list(flags),
  categories: (positional, flags) => categories(flags),
  init: (positional, flags) => {
    if (!positional[0]) usageError("usage: crondex init <id> [--category <name>] [--dest <path>]");
    init(positional[0], flags);
  },
  show: (positional, flags) => {
    if (!positional[0]) usageError("usage: crondex show <id>");
    show(positional[0], flags);
  },
  next: (positional, flags) => {
    if (!positional[0]) usageError("usage: crondex next <id> [--count <n>] [--json]");
    next(positional[0], flags);
  },
  add: (positional, flags) => {
    if (!positional[0]) usageError("usage: crondex add <id> [--dest <path>]");
    add(positional[0], flags);
  },
  recommend: (positional, flags) => {
    if (!positional[0]) usageError('usage: crondex recommend "<what you want done>" [--limit <n>]');
    recommend(positional[0], flags);
  },
  deploy: (positional, flags) => {
    if (!positional[0] && !hasFlagVal(flags, "list-installed")) {
      usageError(
        "usage: crondex deploy <id> [--target crontab|github-actions|systemd|docker] [--mode script|prompt] [--var name=value ...] [--dest <path>] [--install]\n   or: crondex deploy --list-installed [--json]"
      );
    }
    deploy(hasFlagVal(flags, "list-installed") ? undefined : positional[0], flags);
  },
  uninstall: (positional) => {
    if (!positional[0]) usageError("usage: crondex uninstall <id>");
    uninstall(positional[0]);
  },
  update: (positional, flags) => {
    if (!positional[0]) usageError("usage: crondex update <path>");
    update(positional[0], flags);
  },
  doctor: (positional, flags) => doctor(flags),
  bundle: (positional, flags) => {
    if (!positional[0])
      usageError("usage: crondex bundle <file.yaml> [--target <target>] [--dry-run] [--out-dir <path>] [--install]");
    bundle(positional[0], flags);
  },
  mcp: (positional, flags) => {
    // Dynamic import so @modelcontextprotocol/sdk/zod only load into memory for this
    // command — every other command stays as fast/zero-token as it is today.
    import("./mcp-server.js").then((m) => m.startMcpServer({ allowDeploy: hasFlagVal(flags, "allow-deploy") }));
  },
};

export function runCli(argv) {
  const { command, positional, flags } = parseArgs(argv);
  const handler = COMMANDS[command];
  if (!handler) return printHelp();
  handler(positional, flags);
}
