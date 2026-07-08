# crondex

A public, growing directory of pre-made cron jobs — built so any AI agent
(Claude, Codex, Hermes, OpenClaw, or a plain LLM with shell access) can pull
one, tweak it, and schedule it. Clone it, grab a job, adjust the knobs, run it.

## Quick start

```bash
git clone https://github.com/wonsukchoi/crondex.git
cat crondex/catalog.json          # browse what's available
cat crondex/jobs/devops/dependency-audit.yaml   # read one job
```

Give an agent the repo and a goal ("set up something that checks my repo
health every morning") — it reads `catalog.json`, finds the closest match,
adjusts `schedule`/`variables`, and wires it into whatever scheduler it has.

## Layout

```
crondex/
├── catalog.json           generated index of every job — read this first
├── schema/job.schema.json spec every job file follows
├── jobs/
│   ├── devops/
│   └── productivity/
└── scripts/
    ├── build-catalog.js   regenerates catalog.json from jobs/**/*.yaml
    └── validate-jobs.js   validates every job against the schema
```

## Available jobs

| id | category | schedule | runner |
|---|---|---|---|
| `dependency-audit` | devops | `0 8 * * 1` | agent-prompt |
| `log-cleanup` | devops | `30 3 * * *` | shell |
| `repo-health-check` | devops | `0 9 * * 1-5` | agent-prompt |
| `daily-standup-summary` | productivity | `0 8 * * 1-5` | agent-prompt |
| `inbox-triage` | productivity | `0 7,13 * * 1-5` | agent-prompt |
| `weekly-report` | productivity | `0 16 * * 5` | agent-prompt |

Full details (description, tags, variables) live in `catalog.json` and each
job's YAML file.

## How a job works

Every job is one YAML file with a `runner`:

- **`agent-prompt`** — hand the `prompt` field to an LLM agent each run.
  `{{placeholders}}` in the prompt resolve from `variables`.
- **`shell`** — run `command` directly, no LLM needed.

```yaml
id: dependency-audit
name: Dependency Vulnerability Audit
description: ...
category: devops
tags: [security, dependencies]
schedule: "0 8 * * 1"        # standard 5-field cron
timezone: "UTC"
runner: agent-prompt
prompt: |
  ...instructions with {{repo_path}}...
variables:
  repo_path:
    default: "."
    description: ...
compatible_agents: [claude, codex, hermes, openclaw, generic]
```

Full spec: [`schema/job.schema.json`](schema/job.schema.json).

## Using a job

1. Pick a job from `catalog.json`.
2. Override any `variables` and `schedule` for your case.
3. Hand `prompt` (or `command`) plus `schedule` to your scheduler — system
   crontab, a hosted cron, or your agent's own scheduling mechanism. This
   repo defines *what* to run and *when*, not the executor.

## Contributing a job

1. Add `jobs/<category>/<id>.yaml` matching the schema.
2. `npm install` (once).
3. `npm run validate` — checks it against the schema.
4. `npm run build-catalog` — regenerates `catalog.json`.
5. Open a PR.

New categories are just new folders — add one when a job doesn't fit an
existing one, no need to pre-plan the taxonomy.
