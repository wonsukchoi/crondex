// Pure logic for `crondex bundle` — resolves every job listed in a manifest
// the same way `deploy` resolves a single job (variables, mode, placeholder
// substitution — reusing lib/deploy.js's building blocks) and combines the
// results into one artifact set. Kept side-effect-free (no fs writes, no
// crontab access) so it's directly unit-testable; bin/crondex.js's bundle
// command (via lib/cli.js) handles writing files / installing crontab lines.
import * as yaml from "js-yaml";
import {
  resolveVariables,
  substitutePlaceholders,
  pickMode,
  buildCrontabLine,
  buildGithubActionsWorkflow,
  buildSystemdUnits,
  buildDockerArtifacts,
  buildK8sCronJob,
  buildTerraformKubernetesCronJob,
  buildNomadPeriodicJob,
  buildEventBridgeCommand,
  buildCloudSchedulerCommand,
} from "./deploy.js";

const VALID_TARGETS = new Set([
  "crontab",
  "github-actions",
  "systemd",
  "docker",
  "k8s-cronjob",
  "terraform",
  "nomad",
  "eventbridge",
  "cloud-scheduler",
]);

const TARGET_LIST_TEXT =
  '"crontab", "github-actions", "systemd", "docker", "k8s-cronjob", "terraform", "nomad", "eventbridge", or "cloud-scheduler"';

function findJobMeta(catalog, id) {
  const meta = catalog.jobs.find((j) => j.id === id);
  if (!meta) throw new Error(`no job named "${id}" — run "crondex list" to see options.`);
  return meta;
}

// Resolves one manifest entry ({id, vars, mode}) into the same {doc, mode,
// command, prompt} shape `deploy` computes for a single job.
function resolveEntry(entry, catalog, readJobFile) {
  if (!entry || typeof entry.id !== "string" || !entry.id) {
    throw new Error(`bundle entry missing "id" field: ${JSON.stringify(entry)}`);
  }
  const meta = findJobMeta(catalog, entry.id);
  const doc = yaml.load(readJobFile(meta.path));
  doc.path = meta.path;
  const mode = pickMode(doc, entry.mode);
  if (mode === "prompt" && !doc.prompt) {
    throw new Error(`"${entry.id}" has no prompt to deploy (runner: ${doc.runner}).`);
  }
  if (mode === "script" && !doc.command) {
    throw new Error(`"${entry.id}" has no command to deploy (runner: ${doc.runner}).`);
  }
  const values = resolveVariables(doc, entry.vars ?? {});
  const command = doc.command ? substitutePlaceholders(doc.command, values) : undefined;
  const prompt = doc.prompt ? substitutePlaceholders(doc.prompt, values) : undefined;
  return { id: entry.id, doc, mode, command, prompt };
}

// Builds the deploy artifact for one resolved entry against a target — mirrors
// the target dispatch in bin/crondex.js's deploy command / lib/cli.js's deploy().
function buildArtifact({ doc, mode, command, prompt }, target) {
  const text = mode === "prompt" ? prompt : command;
  const isPrompt = mode === "prompt";
  switch (target) {
    case "crontab":
      return buildCrontabLine(doc, text, isPrompt);
    case "github-actions":
      return buildGithubActionsWorkflow(doc, { command, prompt, mode });
    case "systemd":
      return buildSystemdUnits(doc, text, isPrompt);
    case "docker":
      return buildDockerArtifacts(doc, text, isPrompt);
    case "k8s-cronjob":
      return buildK8sCronJob(doc, text, isPrompt);
    case "terraform":
      return buildTerraformKubernetesCronJob(doc, text, isPrompt);
    case "nomad":
      return buildNomadPeriodicJob(doc, text, isPrompt);
    case "eventbridge":
      return buildEventBridgeCommand(doc, text, isPrompt);
    case "cloud-scheduler":
      return buildCloudSchedulerCommand(doc, text, isPrompt);
    default:
      throw new Error(`unknown --target "${target}" — use ${TARGET_LIST_TEXT}.`);
  }
}

// Deploys every job in a manifest ({jobs: [{id, vars, mode}, ...]}) against one
// target. Returns:
//   - for target "crontab": {entries: [{id, line}], output: "<line>\n<line>\n..."}
//   - for every other target: {files: [{name, content}], output: "<concatenated,
//     header-separated artifacts>"} — `files` is what --out-dir writes to disk,
//     one (or a pair, for systemd/docker) per job; `output` is what prints to
//     stdout when there's no --out-dir (or on --dry-run).
export function runBundle(manifest, catalog, { target = "crontab", readJobFile } = {}) {
  if (!VALID_TARGETS.has(target)) {
    throw new Error(`unknown --target "${target}" — use ${TARGET_LIST_TEXT}.`);
  }
  if (!manifest || !Array.isArray(manifest.jobs) || manifest.jobs.length === 0) {
    throw new Error('bundle manifest must have a non-empty "jobs" list, e.g. jobs:\n  - id: some-job-id');
  }
  if (typeof readJobFile !== "function") {
    throw new Error("runBundle requires a readJobFile(path) function.");
  }

  const resolved = manifest.jobs.map((entry) => resolveEntry(entry, catalog, readJobFile));

  if (target === "crontab") {
    const entries = resolved.map((r) => ({ id: r.id, line: buildArtifact(r, target) }));
    return { entries, output: entries.map((e) => e.line).join("\n") + "\n" };
  }

  const files = [];
  const sections = [];
  for (const r of resolved) {
    const artifact = buildArtifact(r, target);
    if (target === "systemd") {
      files.push({ name: `${r.id}.service`, content: artifact.service });
      files.push({ name: `${r.id}.timer`, content: artifact.timer });
      sections.push(`=== ${r.id}.service ===\n${artifact.service}\n=== ${r.id}.timer ===\n${artifact.timer}`);
    } else if (target === "docker") {
      files.push({ name: `${r.id}/Dockerfile`, content: artifact.dockerfile });
      files.push({ name: `${r.id}/crontab`, content: artifact.crontab });
      sections.push(`=== ${r.id}/Dockerfile ===\n${artifact.dockerfile}\n=== ${r.id}/crontab ===\n${artifact.crontab}`);
    } else if (target === "github-actions") {
      files.push({ name: `${r.id}.yml`, content: artifact });
      sections.push(`=== ${r.id}.yml ===\n${artifact}`);
    } else if (target === "k8s-cronjob") {
      files.push({ name: `${r.id}.cronjob.yaml`, content: artifact });
      sections.push(`=== ${r.id}.cronjob.yaml ===\n${artifact}`);
    } else if (target === "terraform") {
      files.push({ name: `${r.id}.tf`, content: artifact });
      sections.push(`=== ${r.id}.tf ===\n${artifact}`);
    } else if (target === "nomad") {
      files.push({ name: `${r.id}.nomad.hcl`, content: artifact });
      sections.push(`=== ${r.id}.nomad.hcl ===\n${artifact}`);
    } else {
      // eventbridge / cloud-scheduler print a CLI command rather than a file
      // that gets applied — still writable to --out-dir for convenience.
      files.push({ name: `${r.id}.txt`, content: artifact });
      sections.push(`=== ${r.id} ===\n${artifact}`);
    }
  }
  return { files, output: sections.join("\n") };
}
