#!/usr/bin/env node
// Verifies the *generated deploy artifact* is well-formed for every catalog job on
// every target — not the job's own command (that's smoke-test.js's job), but the
// output of lib/deploy.js's builders: is the YAML actually parseable, does the
// generated CLI snippet have valid shell syntax. Two systemd/AWS cron-translation
// bugs and one unquoted-YAML-name bug were all found by exactly this kind of check
// (see CHANGELOG 0.70.0) — this makes that check permanent instead of one-off.
//
// Cheap and deterministic (no network calls, no job commands executed), so — unlike
// smoke-test.js — this IS wired into CI (see .github/workflows/validate.yml).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import * as yaml from "js-yaml";
import {
  resolveVariables,
  substitutePlaceholders,
  pickMode,
  buildShellBody,
  buildK8sCronJob,
  buildTerraformKubernetesCronJob,
  buildNomadPeriodicJob,
  buildGithubActionsWorkflow,
  buildEventBridgeCommand,
  buildCloudSchedulerCommand,
} from "../lib/deploy.js";

const HAS_TERRAFORM = (() => {
  try {
    execFileSync("terraform", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
if (!HAS_TERRAFORM) {
  console.warn("terraform not on PATH — skipping `terraform fmt -check` (structural HCL checks still run).");
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JOBS_DIR = join(ROOT, "jobs");
const onlyId = process.argv[2];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) out.push(full);
  }
  return out;
}

// Checks the generated snippet has valid bash syntax without executing it — these
// targets interpolate job.id/job.schedule/job.timezone/the resolved command into a
// template-literal-built CLI invocation, so a future field that isn't schema-
// restricted (like job.name already wasn't) could break shell syntax the same way.
function assertValidBashSyntax(rel, target, text) {
  try {
    execFileSync("bash", ["-n"], { input: text, stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    throw new Error(`${rel} [${target}]: generated snippet has invalid bash syntax\n${err.stderr?.toString().trim()}`);
  }
}

function assertValidYaml(rel, target, text, checks) {
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (err) {
    throw new Error(`${rel} [${target}]: generated artifact is not valid YAML\n${err.message}`);
  }
  for (const [desc, ok] of checks(parsed)) {
    if (!ok) throw new Error(`${rel} [${target}]: generated YAML failed check: ${desc}`);
  }
}

// Doesn't need the terraform binary — a pure structural invariant on the generated
// text. This file never intentionally emits real Terraform interpolation/directives,
// so every `${`/`%{` in the output must be part of the doubled `$${`/`%%{` escape
// lib/deploy.js's hclString() is supposed to produce. This is exactly the check that
// would have caught the "$$ is a JS String.replace() escape, not two literal dollar
// signs" bug found while building this target (see CHANGELOG) — a bare `${` here
// means that escaping silently failed for this job's command.
function assertNoUnescapedHclInterpolation(rel, target, text) {
  for (const [marker, name] of [
    ["${", "interpolation"],
    ["%{", "directive"],
  ]) {
    let index = text.indexOf(marker);
    while (index !== -1) {
      if (text[index - 1] !== marker[0]) {
        throw new Error(
          `${rel} [${target}]: unescaped "${marker}" (HCL ${name} syntax) found at index ${index} — hclString() escaping failed for this job's command.`
        );
      }
      index = text.indexOf(marker, index + 1);
    }
  }
}

function assertValidTerraformSyntax(rel, target, text) {
  if (!HAS_TERRAFORM) return;
  try {
    execFileSync("terraform", ["fmt", "-check", "-"], { input: text, stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    // exit 1 alone means "would reformat" (fine, not a syntax error) — only a nonzero
    // exit WITH stderr output means terraform couldn't parse the HCL at all.
    const stderr = err.stderr?.toString().trim();
    if (stderr) throw new Error(`${rel} [${target}]: terraform fmt rejected the generated HCL\n${stderr}`);
  }
}

let checked = 0;
let failed = 0;

for (const file of walk(JOBS_DIR)) {
  const doc = yaml.load(readFileSync(file, "utf8"));
  if (onlyId && doc.id !== onlyId) continue;
  doc.path = relative(ROOT, file);
  const rel = doc.path;

  const values = resolveVariables(doc);
  const command = doc.command ? substitutePlaceholders(doc.command, values) : undefined;
  const prompt = doc.prompt ? substitutePlaceholders(doc.prompt, values) : undefined;
  const mode = pickMode(doc, undefined);
  const isPrompt = mode === "prompt";
  const resolvedText = isPrompt ? prompt : command;

  checked++;
  try {
    if (resolvedText !== undefined) {
      assertValidYaml(rel, "k8s-cronjob", buildK8sCronJob(doc, resolvedText, isPrompt), (m) => [
        ["kind is CronJob", m?.kind === "CronJob"],
        ["metadata.name is set", typeof m?.metadata?.name === "string"],
        ["spec.schedule matches the job schedule", m?.spec?.schedule === doc.schedule],
      ]);

      // crontab, systemd's ExecStart=, and docker's /etc/cron.d entry all embed this
      // exact string (see lib/deploy.js's buildShellBody) as the command they invoke —
      // checking it once here covers all three, rather than three near-duplicate checks.
      assertValidBashSyntax(rel, "shell-body (crontab/systemd/docker)", buildShellBody(resolvedText, isPrompt));

      assertValidBashSyntax(rel, "eventbridge", buildEventBridgeCommand(doc, resolvedText, isPrompt));
      assertValidBashSyntax(rel, "cloud-scheduler", buildCloudSchedulerCommand(doc, resolvedText, isPrompt));

      const tf = buildTerraformKubernetesCronJob(doc, resolvedText, isPrompt);
      assertNoUnescapedHclInterpolation(rel, "terraform", tf);
      assertValidTerraformSyntax(rel, "terraform", tf);

      // Nomad job specs are also HCL2 and reuse the same hclString() escaping as the
      // terraform target — same structural invariant applies. No `nomad` binary syntax
      // check (unlike terraform): nomad is far less likely to be on a CI runner's PATH
      // and its fmt/validate flags aren't worth guessing at; the structural check is
      // what actually caught the real escaping bug this file exists to prevent.
      assertNoUnescapedHclInterpolation(rel, "nomad", buildNomadPeriodicJob(doc, resolvedText, isPrompt));
    }

    assertValidYaml(rel, "github-actions", buildGithubActionsWorkflow(doc, { command, prompt, mode }), (w) => [
      ["name matches the job name", w?.name === doc.name],
      ["has a schedule trigger", w?.on?.schedule?.[0]?.cron === doc.schedule],
      ["has a run job with steps", Array.isArray(w?.jobs?.run?.steps)],
    ]);
  } catch (err) {
    console.error(err.message);
    console.error();
    failed++;
  }
}

console.log(
  `checked ${checked} job(s) across k8s-cronjob/terraform/nomad/github-actions/eventbridge/cloud-scheduler/shell-body artifacts, ${failed} failed`
);
if (failed > 0) process.exit(1);
