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
function buildShellBody(resolvedText, isPrompt) {
  const escaped = escapeSingleQuotes(flattenScript(resolvedText));
  return isPrompt
    ? `\${CRONDEX_AGENT_CLI:?set CRONDEX_AGENT_CLI to your agent CLI invocation, e.g. "claude -p"} '${escaped}'`
    : `bash -lc '${escaped}'`;
}

// Flattens a (possibly multi-line) resolved command/prompt into one crontab line.
export function buildCrontabLine(job, resolvedText, isPrompt) {
  return `${job.schedule} ${buildShellBody(resolvedText, isPrompt)} # crondex:${job.id}`;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Numeric cron fields (minute/hour/day-of-month/month) map onto systemd calendar
// syntax almost unchanged — the one gotcha is `*/n`, which systemd requires written
// as `0/n` (a bare `*` can't carry a step). Comma lists and `a-b` ranges pass through.
function translateNumericField(field) {
  return field.replace(/^\*\/(\d+)$/, "0/$1");
}

// Cron's day-of-week field is numeric (0-6 or 7, both Sun); systemd wants weekday
// names. Only handles the shapes crondex jobs actually use (digit, list, a-b range) —
// not the rarer `a-b/n` step-in-range cron syntax, which is explicitly rejected below
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
      if (range) return `${DOW[Number(range[1]) % 7]}-${DOW[Number(range[2]) % 7]}`;
      return DOW[Number(part) % 7];
    })
    .join(",");
}

// Converts a standard 5-field cron schedule into a systemd OnCalendar= expression.
export function cronToSystemdCalendar(schedule) {
  const [minute, hour, dom, month, dow] = schedule.trim().split(/\s+/);
  const weekday = translateWeekdayField(dow);
  const date = `*-${translateNumericField(month)}-${translateNumericField(dom)}`;
  const time = `${translateNumericField(hour)}:${translateNumericField(minute)}:00`;
  return weekday ? `${weekday} ${date} ${time}` : `${date} ${time}`;
}

// Builds a systemd service+timer unit pair for the job. Prompt-mode jobs still defer
// to CRONDEX_AGENT_CLI (see buildCrontabLine) — systemd services run with a minimal
// environment, so the unit points at EnvironmentFile as the place to set it.
export function buildSystemdUnits(job, resolvedText, isPrompt) {
  const body = buildShellBody(resolvedText, isPrompt);
  const service = `[Unit]
Description=${job.name} (crondex:${job.id})

[Service]
Type=oneshot
${isPrompt ? "# prompt-mode job — set CRONDEX_AGENT_CLI, e.g. via EnvironmentFile=/etc/crondex/${job.id}.env\n" : ""}ExecStart=/bin/bash -c '${body.replace(/'/g, `'"'"'`)}'
`;
  const timer = `[Unit]
Description=${job.name} timer (crondex:${job.id})

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

// YAML double-quoted scalars only need backslash and the quote itself escaped —
// used for embedding an arbitrary shell body inside a k8s manifest's command array.
function yamlDoubleQuote(text) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
${job.timezone ? `  # spec.timeZone requires Kubernetes 1.27+ (stable CronJob timeZone field).
  timeZone: "${job.timezone}"
` : ""}  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: ${job.id}
              image: bash:5
${isPrompt ? `              env:
                - name: CRONDEX_AGENT_CLI
                  value: "REPLACE_ME"  # e.g. "claude -p"
` : ""}              command: ["${shell}", "-lc", ${yamlDoubleQuote(command)}]
`;
}

const AWS_DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// AWS's cron() requires exactly one of day-of-month/day-of-week to be "?" — the other
// carries the restriction. Cron's day-of-week is numeric (0-6 or 7, both Sun); AWS
// wants day names. Minute/hour/month pass through unchanged except `*/n` -> `0/n`
// (same systemd gotcha — a bare `*` can't carry a step).
export function cronToAwsCron(schedule) {
  const [minute, hour, dom, month, dow] = schedule.trim().split(/\s+/);
  const min = translateNumericField(minute);
  const hr = translateNumericField(hour);
  const mon = translateNumericField(month);
  if (dow === "*") {
    return `cron(${min} ${hr} ${translateNumericField(dom)} ${mon} ? *)`;
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
// wrong hour.
export function buildGithubActionsWorkflow(job, { command, prompt, mode }) {
  const lines = [];
  lines.push(`name: ${job.name}`);
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
    lines.push(
      "        # TODO: wire up your agent CLI/action here — this step only prints the resolved prompt."
    );
    lines.push("        run: |");
    lines.push("          cat <<'CRONDEX_PROMPT'");
    for (const l of prompt.trimEnd().split("\n")) lines.push(`          ${l}`);
    lines.push("          CRONDEX_PROMPT");
  }
  return lines.join("\n") + "\n";
}
