# crondex

A public, growing directory of pre-made cron jobs — written so any AI agent
(Claude, Codex, Hermes, OpenClaw, or a plain LLM with shell access) can pull
one, tweak it, and schedule it. Start small, grow the catalog over time.

## Layout

```
crondex/
├── catalog.json          # generated index of every job — read this first
├── schema/job.schema.json
├── jobs/
│   ├── devops/
│   └── productivity/
└── scripts/
    ├── build-catalog.js   # regenerates catalog.json from jobs/**/*.yaml
    └── validate-jobs.js   # validates every job against the schema
```

## For an agent consuming this repo

1. Fetch `catalog.json` — it lists every job's `id`, `name`, `description`,
   `category`, `tags`, `schedule`, `runner`, and `path`. Pick by matching the
   task you're asked to do against `description`/`tags`.
2. Read the job file at `path` (a small YAML file).
3. Adjust the fields you need — most jobs expose a `variables` block with
   named, default-valued knobs so you rarely need to touch `prompt`/`command`
   directly. Override `schedule` to fit the user's cadence.
4. Wire the result into whatever your host uses to actually run cron
   (system crontab, a hosted scheduler, this agent's own `/schedule`-style
   mechanism, etc.) — this repo only defines *what* to run and *when*, not
   the executor.

Each job has one of two `runner` types:

- `agent-prompt` — hand the `prompt` field to an LLM agent each run.
  Placeholders like `{{repo_path}}` get substituted from `variables`.
- `shell` — run `command` directly, no LLM needed.

## Job format

See [`schema/job.schema.json`](schema/job.schema.json) for the full spec.
Every job is one YAML file:

```yaml
id: dependency-audit
name: Dependency Vulnerability Audit
description: ...
category: devops
tags: [security, dependencies]
schedule: "0 8 * * 1"      # standard 5-field cron
timezone: "UTC"
runner: agent-prompt
prompt: |
  ...instructions with {{placeholders}}...
variables:
  repo_path:
    default: "."
    description: ...
compatible_agents: [claude, codex, hermes, openclaw, generic]
```

## Contributing a job

1. Add a YAML file under `jobs/<category>/<id>.yaml` matching the schema.
2. `npm install` (once), then `npm run validate` to check it.
3. `npm run build-catalog` to regenerate `catalog.json`.
4. Open a PR.

Categories grow as needed — don't over-plan the taxonomy up front, add a
new folder when a job doesn't fit an existing one.
