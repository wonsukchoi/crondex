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

// Flattens a (possibly multi-line) resolved command/prompt into one crontab line.
// isPrompt jobs can't assume any particular agent CLI syntax, so the line defers to
// a CRONDEX_AGENT_CLI env var the user sets themselves (e.g. `export
// CRONDEX_AGENT_CLI="claude -p"`) rather than guessing wrong.
export function buildCrontabLine(job, resolvedText, isPrompt) {
  const flat = resolvedText.trim().replace(/\s*\n\s*/g, " ");
  const escaped = escapeSingleQuotes(flat);
  const body = isPrompt
    ? `\${CRONDEX_AGENT_CLI:?set CRONDEX_AGENT_CLI to your agent CLI invocation, e.g. "claude -p"} '${escaped}'`
    : `bash -lc '${escaped}'`;
  return `${job.schedule} ${body} # crondex:${job.id}`;
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
// not the rarer `a-b/n` step-in-range cron syntax.
function translateWeekdayField(field) {
  if (field === "*") return null;
  return field
    .split(",")
    .map((part) => {
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
  const flat = resolvedText.trim().replace(/\s*\n\s*/g, " ");
  const escaped = escapeSingleQuotes(flat);
  const body = isPrompt
    ? `\${CRONDEX_AGENT_CLI:?set CRONDEX_AGENT_CLI to your agent CLI invocation, e.g. "claude -p"} '${escaped}'`
    : `bash -lc '${escaped}'`;
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
  const flat = resolvedText.trim().replace(/\s*\n\s*/g, " ");
  const escaped = escapeSingleQuotes(flat);
  const body = isPrompt
    ? `\${CRONDEX_AGENT_CLI:?set CRONDEX_AGENT_CLI to your agent CLI invocation, e.g. "claude -p"} '${escaped}'`
    : `bash -lc '${escaped}'`;
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
