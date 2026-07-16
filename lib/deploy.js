// Turns a resolved crondex job into a deployment artifact — pulled out of
// bin/crondex.js's `deploy` command so it's unit testable (see test/deploy.test.js).

const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;

// Merges a job's `variables` defaults with any user-supplied overrides.
export function resolveVariables(job, overrides = {}) {
  const values = {};
  for (const [name, spec] of Object.entries(job.variables ?? {})) {
    values[name] = name in overrides ? overrides[name] : spec.default;
  }
  return values;
}

// crondex substitutes {{placeholders}} as literal text — this mirrors that exactly,
// leaving a placeholder untouched if no value was resolved for it (rather than
// silently dropping it, which would produce a broken script with no warning).
export function substitutePlaceholders(text, values) {
  return text.replace(PLACEHOLDER_RE, (match, name) => (name in values ? String(values[name]) : match));
}

// hybrid jobs support both — shell/agent-prompt jobs only support their one mode.
export function pickMode(job, requestedMode) {
  if (job.runner === "shell") return "script";
  if (job.runner === "agent-prompt") return "prompt";
  return requestedMode === "prompt" ? "prompt" : "script";
}

function escapeSingleQuotes(text) {
  return text.replace(/'/g, `'"'"'`);
}

// Collapses a (possibly multi-line) resolved command/prompt onto one line.
function flattenScript(resolvedText) {
  return resolvedText.trim().replace(/\s*\n\s*/g, " ");
}

// Builds a single-quoted shell invocation from a flattened script. isPrompt jobs can't
// assume any particular agent CLI syntax, so the body defers to a CRONDEX_AGENT_CLI env
// var the user sets themselves (e.g. `export CRONDEX_AGENT_CLI="claude -p"`) rather than
// guessing wrong. Shared by every deploy target that embeds the job as a single-quoted
// string inside a larger shell line (crontab, systemd, docker) — targets that build
// their own command array (k8s) flatten/quote the script directly instead.
export function buildShellBody(resolvedText, isPrompt) {
  const escaped = escapeSingleQuotes(flattenScript(resolvedText));
  return isPrompt
    ? `\${CRONDEX_AGENT_CLI:?set CRONDEX_AGENT_CLI to your agent CLI invocation, e.g. "claude -p"} '${escaped}'`
    : `bash -lc '${escaped}'`;
}

// Builds the crontab comment marker for a job — `# crondex:<id>@<version>` when
// the job carries a version (every catalog job does), `# crondex:<id>` otherwise.
// `crondex doctor` (lib/doctor.js) parses both forms — the unversioned form is
// kept for backward compat with lines installed before version tagging existed.
export function crondexMarker(job) {
  return job.version !== undefined ? `# crondex:${job.id}@${job.version}` : `# crondex:${job.id}`;
}

// Flattens a (possibly multi-line) resolved command/prompt into one crontab line.
export function buildCrontabLine(job, resolvedText, isPrompt) {
  return `${job.schedule} ${buildShellBody(resolvedText, isPrompt)} ${crondexMarker(job)}`;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// `*/n` -> `0/n` (a bare `*` can't carry a step) is needed by both systemd and AWS
// EventBridge — AWS's own docs use `0/15`, not `*/15`, as the canonical form. This
// is the shared subset; see translateSystemdNumericField below for the systemd-only
// range-operator fix (AWS keeps cron's `-` for ranges, systemd doesn't accept it).
function stepOnlyNumericField(field) {
  return field.replace(/^\*\/(\d+)$/, "0/$1");
}

// Numeric cron fields (minute/hour/day-of-month/month) map onto systemd calendar
// syntax almost unchanged — two gotchas beyond the shared `*/n` rewrite above: `a-b`
// ranges, which systemd requires written as `a..b` (a bare hyphen is a date-literal
// separator like `2012-10-10`, not a range operator — a plain `-` here silently
// produces a value systemd either rejects or, worse, mis-parses). `a-b/n`
// step-in-range carries the same fix plus the step rewrite. This is systemd-only —
// don't reuse it for AWS (cronToAwsCron), which wants the hyphen kept as-is.
function translateSystemdNumericPart(part) {
  const starStep = part.match(/^\*\/(\d+)$/);
  if (starStep) return `0/${starStep[1]}`;
  const rangeStep = part.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (rangeStep) return `${rangeStep[1]}..${rangeStep[2]}/${rangeStep[3]}`;
  const range = part.match(/^(\d+)-(\d+)$/);
  if (range) return `${range[1]}..${range[2]}`;
  return part;
}

function translateSystemdNumericField(field) {
  return field.split(",").map(translateSystemdNumericPart).join(",");
}

// Cron's day-of-week field is numeric (0-6 or 7, both Sun); systemd wants weekday
// names, and ranges written with `..` rather than cron's `-` (see
// translateSystemdNumericPart above — same hyphen-isn't-a-range-operator gotcha).
// Only handles the shapes crondex jobs actually use (digit, list, a-b range) — not
// the rarer `a-b/n` step-in-range cron syntax, which is explicitly rejected below
// rather than silently mistranslated (Number("1-5/2") is NaN, so DOW[NaN % 7] would
// otherwise produce the literal string "undefined" in the generated OnCalendar=).
function translateWeekdayField(field) {
  if (field === "*") return null;
  return field
    .split(",")
    .map((part) => {
      if (part.includes("/")) {
        throw new Error(
          `unsupported day-of-week step-in-range syntax "${part}" in schedule day-of-week field "${field}" — systemd translation doesn't support cron's a-b/n step-in-range syntax`
        );
      }
      const range = part.match(/^(\d)-(\d)$/);
      if (range) return `${DOW[Number(range[1]) % 7]}..${DOW[Number(range[2]) % 7]}`;
      return DOW[Number(part) % 7];
    })
    .join(",");
}

// Converts a standard 5-field cron schedule into a systemd OnCalendar= expression.
export function cronToSystemdCalendar(schedule) {
  const [minute, hour, dom, month, dow] = schedule.trim().split(/\s+/);
  const weekday = translateWeekdayField(dow);
  const date = `*-${translateSystemdNumericField(month)}-${translateSystemdNumericField(dom)}`;
  const time = `${translateSystemdNumericField(hour)}:${translateSystemdNumericField(minute)}:00`;
  return weekday ? `${weekday} ${date} ${time}` : `${date} ${time}`;
}

// systemd unit-file values are read one line at a time — a job.name containing a raw
// newline would split into extra, invalid lines. job.name has no schema restriction
// against that, so collapse defensively rather than trust it's always single-line.
function oneLine(text) {
  return text.replace(/\r?\n/g, " ");
}

// Builds a systemd service+timer unit pair for the job. Prompt-mode jobs still defer
// to CRONDEX_AGENT_CLI (see buildCrontabLine) — systemd services run with a minimal
// environment, so the unit points at EnvironmentFile as the place to set it.
export function buildSystemdUnits(job, resolvedText, isPrompt) {
  const body = buildShellBody(resolvedText, isPrompt);
  const service = `[Unit]
Description=${oneLine(job.name)} (crondex:${job.id})

[Service]
Type=oneshot
${isPrompt ? "# prompt-mode job — set CRONDEX_AGENT_CLI, e.g. via EnvironmentFile=/etc/crondex/${job.id}.env\n" : ""}ExecStart=/bin/bash -c '${body.replace(/'/g, `'"'"'`)}'
`;
  const timer = `[Unit]
Description=${oneLine(job.name)} timer (crondex:${job.id})

[Timer]
OnCalendar=${cronToSystemdCalendar(job.schedule)}
Persistent=true

[Install]
WantedBy=timers.target
`;
  return { service, timer };
}

// Builds a Dockerfile + /etc/cron.d entry that runs the job on its own schedule
// inside a container — for teams that want the job shipped as an image rather than
// installed on a host crontab or run via CI.
export function buildDockerArtifacts(job, resolvedText, isPrompt) {
  const body = buildShellBody(resolvedText, isPrompt);
  const crontab = `${job.schedule} root ${body} # crondex:${job.id}\n`;
  const dockerfile = `# Generated by \`crondex deploy ${job.id} --target docker\` from ${job.path}.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends cron bash ca-certificates \\
    && rm -rf /var/lib/apt/lists/*
COPY crontab /etc/cron.d/crondex-job
RUN chmod 0644 /etc/cron.d/crondex-job && crontab /etc/cron.d/crondex-job && touch /var/log/cron.log
${isPrompt ? "# NOTE: prompt-mode job — pass CRONDEX_AGENT_CLI via `docker run -e` so cron's environment has it.\n" : ""}CMD ["sh", "-c", "cron && tail -f /var/log/cron.log"]
`;
  return { dockerfile, crontab };
}

// YAML double-quoted scalars: backslash, the quote itself, and literal newlines/CRs
// (a raw newline breaks a double-quoted scalar written on one line — job.name and
// job.id are free-text fields with no schema length/character restriction, so this
// has to handle whatever they contain, not just the flattened-shell-command case it
// was originally written for).
function yamlDoubleQuote(text) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

// Builds a self-contained batch/v1 CronJob manifest — the one target here that
// actually runs the job (crontab/systemd/docker's sibling), rather than just
// scheduling an invocation of something else the user still has to build (see
// buildEventBridgeCommand/buildCloudSchedulerCommand below).
export function buildK8sCronJob(job, resolvedText, isPrompt) {
  const flat = flattenScript(resolvedText);
  const shell = isPrompt ? "sh" : "bash";
  const command = isPrompt
    ? `\${CRONDEX_AGENT_CLI:?set CRONDEX_AGENT_CLI to your agent CLI invocation, e.g. "claude -p"} '${escapeSingleQuotes(flat)}'`
    : flat;
  return `# Generated by \`crondex deploy ${job.id} --target k8s-cronjob\` from ${job.path}.
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${job.id}
  labels:
    app.kubernetes.io/managed-by: crondex
spec:
  schedule: "${job.schedule}"
${
  job.timezone
    ? `  # spec.timeZone requires Kubernetes 1.27+ (stable CronJob timeZone field).
  timeZone: "${job.timezone}"
`
    : ""
}  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: ${job.id}
              image: bash:5
${
  isPrompt
    ? `              env:
                - name: CRONDEX_AGENT_CLI
                  value: "REPLACE_ME"  # e.g. "claude -p"
`
    : ""
}              command: ["${shell}", "-lc", ${yamlDoubleQuote(command)}]
`;
}

// HCL double-quoted string literals: backslash, the quote, and newlines/CRs need the
// same escaping as YAML (see yamlDoubleQuote) — plus one HCL-specific gotcha: `${` and
// `%{` are template-interpolation/directive markers, so a literal one has to be written
// doubled (`$${`, `%%{`). This matters a lot here specifically: unlike job.name (rarely
// contains `${`), resolved shell commands very commonly do — `${VAR:-default}`-style
// bash parameter expansion is common enough that ~5% of the catalog's job commands
// contain a literal `${` (verified by scanning at the time this was written). Getting
// this wrong wouldn't just produce ugly output, it'd make Terraform try to interpolate
// part of the user's shell command as a Terraform expression and fail (or worse,
// silently reference an unrelated Terraform value that happens to share the name).
function hclString(text) {
  return `"${text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    // "$$$${" / "%%%%{" look odd but are required: in a String.replace() replacement
    // string, "$$" is itself a special escape for one literal "$" (a JS gotcha, not an
    // HCL one) — so producing the literal two-dollar-sign "$${" this function needs
    // takes four "$" in the replacement string, collapsing pairwise into two. The
    // unit test asserting the exact output ("$${HOST...") is what catches a regression
    // here — this is the kind of silent-no-op mistake that's easy to reintroduce.
    .replace(/\$\{/g, "$$$${")
    .replace(/%\{/g, "%%{")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

// Builds a Terraform resource for a `kubernetes_cron_job_v1` (the Kubernetes provider)
// — like buildK8sCronJob, this is a target that actually runs the job, not just one
// that schedules an invocation of something else the user still has to build (see
// buildEventBridgeCommand/buildCloudSchedulerCommand below). Deliberately mirrors
// buildK8sCronJob's structure/behavior field-for-field so the two stay in lockstep;
// the difference is HCL syntax instead of YAML, and HCL's `${`/`%{` escaping gotcha
// above. The Terraform resource's local name (the second string after the resource
// type) uses underscores rather than job.id's hyphens — plain hyphens are valid in
// HCL identifiers, but underscored is the near-universal Terraform convention, so this
// avoids surprising anyone pasting the id in expecting `crondex_deploy_my_job` style
// references. The actual Kubernetes resource name (`metadata.name`) keeps job.id as-is.
export function buildTerraformKubernetesCronJob(job, resolvedText, isPrompt) {
  const flat = flattenScript(resolvedText);
  const shell = isPrompt ? "sh" : "bash";
  const command = isPrompt
    ? `\${CRONDEX_AGENT_CLI:?set CRONDEX_AGENT_CLI to your agent CLI invocation, e.g. "claude -p"} '${escapeSingleQuotes(flat)}'`
    : flat;
  const resourceName = job.id.replace(/-/g, "_");
  return `# Generated by \`crondex deploy ${job.id} --target terraform\` from ${job.path}.
# Requires the Kubernetes provider: https://registry.terraform.io/providers/hashicorp/kubernetes
resource "kubernetes_cron_job_v1" "${resourceName}" {
  metadata {
    name = "${job.id}"
    labels = {
      "app.kubernetes.io/managed-by" = "crondex"
    }
  }
  spec {
    schedule           = "${job.schedule}"
    concurrency_policy = "Allow"
${
  job.timezone
    ? `    # time_zone requires Kubernetes 1.27+ and Terraform kubernetes provider >= 2.20.
    time_zone = "${job.timezone}"
`
    : ""
}    job_template {
      metadata {}
      spec {
        template {
          metadata {}
          spec {
            restart_policy = "OnFailure"
            container {
              name    = "${job.id}"
              image   = "bash:5"
              command = ["${shell}", "-lc", ${hclString(command)}]
${
  isPrompt
    ? `              env {
                name  = "CRONDEX_AGENT_CLI"
                value = "REPLACE_ME" # e.g. "claude -p"
              }
`
    : ""
}            }
          }
        }
      }
    }
  }
}
`;
}

// Builds a Nomad periodic batch job spec (HCL) — like buildK8sCronJob and
// buildTerraformKubernetesCronJob, this actually runs the job rather than just
// scheduling an invocation of something else. Mirrors buildTerraformKubernetesCronJob's
// structure (same hclString() escaping, same isPrompt/CRONDEX_AGENT_CLI handling) since
// both emit HCL — the difference is Nomad's job/periodic/group/task shape instead of a
// single kubernetes_cron_job_v1 resource. `datacenters = ["dc1"]` is Nomad's own
// placeholder convention (a job spec can't omit datacenters) — left as the one thing a
// user is expected to edit for their cluster, same spirit as k8s's REPLACE_ME env value.
export function buildNomadPeriodicJob(job, resolvedText, isPrompt) {
  const flat = flattenScript(resolvedText);
  const shell = isPrompt ? "sh" : "bash";
  const command = isPrompt
    ? `\${CRONDEX_AGENT_CLI:?set CRONDEX_AGENT_CLI to your agent CLI invocation, e.g. "claude -p"} '${escapeSingleQuotes(flat)}'`
    : flat;
  return `# Generated by \`crondex deploy ${job.id} --target nomad\` from ${job.path}.
job "${job.id}" {
  datacenters = ["dc1"] # edit to match your cluster
  type        = "batch"

  periodic {
    cron             = "${job.schedule}"
${
  job.timezone
    ? `    time_zone        = "${job.timezone}"
`
    : ""
}    prohibit_overlap = true
  }

  group "${job.id}" {
    task "${job.id}" {
      driver = "docker"

      config {
        image   = "bash:5"
        command = "${shell}"
        args    = ["-lc", ${hclString(command)}]
      }
${
  isPrompt
    ? `
      env {
        CRONDEX_AGENT_CLI = "REPLACE_ME" # e.g. "claude -p"
      }
`
    : ""
}    }
  }
}
`;
}

const AWS_DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// AWS's cron() requires exactly one of day-of-month/day-of-week to be "?" — the other
// carries the restriction, so AWS can't represent a schedule that restricts both (Vixie
// cron treats that combination as OR — "on the 15th, or any Friday" — which AWS's
// grammar has no way to express). Rather than silently keeping one restriction and
// dropping the other (previously: dow winning, dom silently discarded whenever both
// were set — nothing in the catalog hit this, but any user-authored job via `add`/
// `init` could), this now rejects it the same way the day-of-week step-in-range case
// already does elsewhere in this file. Cron's day-of-week is numeric (0-6 or 7, both
// Sun); AWS wants day names. Minute/hour/month/day-of-month pass through unchanged
// (AWS keeps cron's `-` for ranges) except `*/n` -> `0/n` (a bare `*` can't carry a
// step; AWS's own docs use `0/15`, not `*/15`, as the canonical form).
export function cronToAwsCron(schedule) {
  const [minute, hour, dom, month, dow] = schedule.trim().split(/\s+/);
  const min = stepOnlyNumericField(minute);
  const hr = stepOnlyNumericField(hour);
  const mon = stepOnlyNumericField(month);
  if (dow === "*") {
    return `cron(${min} ${hr} ${stepOnlyNumericField(dom)} ${mon} ? *)`;
  }
  if (dom !== "*") {
    throw new Error(
      `unsupported schedule "${schedule}" — both day-of-month ("${dom}") and day-of-week ("${dow}") are restricted, which cron treats as OR but AWS cron() can't express (it requires exactly one of the two to be "?"). Split this into two separate deploys, or restrict only one field.`
    );
  }
  const awsDow = dow
    .split(",")
    .map((part) => {
      if (part.includes("/")) {
        throw new Error(
          `unsupported day-of-week step-in-range syntax "${part}" in schedule day-of-week field "${dow}" — AWS cron translation doesn't support cron's a-b/n step-in-range syntax`
        );
      }
      const range = part.match(/^(\d)-(\d)$/);
      if (range) return `${AWS_DOW[Number(range[1]) % 7]}-${AWS_DOW[Number(range[2]) % 7]}`;
      return AWS_DOW[Number(part) % 7];
    })
    .join(",");
  return `cron(${min} ${hr} ? ${mon} ${awsDow} *)`;
}

// EventBridge Scheduler (unlike crontab/systemd/docker/k8s) can't run a shell command
// directly — it invokes a target ARN (Lambda/ECS/Step Functions). So this only gets
// the schedule right and leaves the target as a TODO, same spirit as the GitHub
// Actions prompt-mode TODO: get the user unstuck, don't guess their infra for them.
export function buildEventBridgeCommand(job, resolvedText, isPrompt) {
  const body = buildShellBody(resolvedText, isPrompt);
  return `# Generated by \`crondex deploy ${job.id} --target eventbridge\` from ${job.path}.
# EventBridge Scheduler invokes a target (Lambda/ECS/Step Functions) — it can't run a
# shell command directly. Point TODO_TARGET_ARN/TODO_ROLE_ARN at something that runs:
#   ${body}
aws scheduler create-schedule \\
  --name "${job.id}" \\
  --schedule-expression "${cronToAwsCron(job.schedule)}" \\
  --flexible-time-window '{"Mode":"OFF"}' \\
  --target '{"Arn":"TODO_TARGET_ARN","RoleArn":"TODO_ROLE_ARN"}'
`;
}

// Cloud Scheduler accepts standard unix-cron directly (no conversion needed) but, like
// EventBridge, invokes an HTTP/Pub/Sub/App Engine target rather than running a shell
// command itself — --uri is left as a TODO for whatever endpoint actually runs it.
export function buildCloudSchedulerCommand(job, resolvedText, isPrompt) {
  const body = buildShellBody(resolvedText, isPrompt);
  return `# Generated by \`crondex deploy ${job.id} --target cloud-scheduler\` from ${job.path}.
# Cloud Scheduler invokes an HTTP endpoint (e.g. a Cloud Run job) — it can't run a
# shell command directly. Point TODO_HTTPS_ENDPOINT at something that runs:
#   ${body}
gcloud scheduler jobs create http "${job.id}" \\
  --schedule="${job.schedule}" \\
  --uri="TODO_HTTPS_ENDPOINT" \\
  --http-method=POST \\
  --time-zone="${job.timezone ?? "UTC"}"
`;
}

// Builds a ready-to-commit GitHub Actions workflow file for the job. GitHub Actions
// schedules always run in UTC regardless of the `cron:` string's intent, so a
// non-UTC job gets a visible warning comment rather than silently firing at the
// wrong hour. job.name is quoted (not emitted as a bare YAML plain scalar) — the
// schema puts no character restriction on `name`, and a plain scalar starting with
// e.g. `#`/`-`/`"` or containing `: ` breaks YAML parsing (nothing in the catalog
// hits this today, but user-authored jobs via `add`/`init` aren't restricted either).
export function buildGithubActionsWorkflow(job, { command, prompt, mode }) {
  const lines = [];
  lines.push(`name: ${yamlDoubleQuote(job.name)}`);
  lines.push(`# Generated by \`crondex deploy ${job.id} --target github-actions\` from ${job.path}.`);
  if (job.timezone && job.timezone !== "UTC") {
    lines.push(`# NOTE: this job's schedule ("${job.schedule}") is defined in ${job.timezone}, but GitHub`);
    lines.push(`# Actions cron always runs in UTC — adjust the hour field(s) below if timing matters.`);
  }
  lines.push("");
  lines.push("on:");
  lines.push("  schedule:");
  lines.push(`    - cron: "${job.schedule}"`);
  lines.push("  workflow_dispatch: {}");
  lines.push("");
  lines.push("jobs:");
  lines.push("  run:");
  lines.push("    runs-on: ubuntu-latest");
  lines.push("    steps:");
  lines.push("      - uses: actions/checkout@v4");
  if (mode === "script") {
    lines.push("      - name: run job");
    lines.push("        run: |");
    for (const l of command.trimEnd().split("\n")) lines.push(`          ${l}`);
  } else {
    lines.push("      - name: run job (agent-prompt)");
    lines.push("        # TODO: wire up your agent CLI/action here — this step only prints the resolved prompt.");
    lines.push("        run: |");
    lines.push("          cat <<'CRONDEX_PROMPT'");
    for (const l of prompt.trimEnd().split("\n")) lines.push(`          ${l}`);
    lines.push("          CRONDEX_PROMPT");
  }
  return lines.join("\n") + "\n";
}
