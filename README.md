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

| id | category | schedule | modes |
|---|---|---|---|
| `dependency-audit` | devops | `0 8 * * 1` | script + agent-prompt |
| `log-cleanup` | devops | `30 3 * * *` | script |
| `repo-health-check` | devops | `0 9 * * 1-5` | script + agent-prompt |
| `backup-reminder` | devops | `0 9 * * *` | script |
| `ssl-cert-expiry-check` | devops | `0 6 * * *` | script |
| `uptime-ping-check` | devops | `*/15 * * * *` | script |
| `cost-alert` | devops | `0 7 * * *` | script + agent-prompt |
| `daily-standup-summary` | productivity | `0 8 * * 1-5` | script + agent-prompt |
| `inbox-triage` | productivity | `0 7,13 * * 1-5` | agent-prompt only |
| `weekly-report` | productivity | `0 16 * * 5` | script + agent-prompt |

Full details (description, tags, variables) live in `catalog.json` and each
job's YAML file.

## How a job works

Every job is one YAML file with a `runner`:

- **`shell`** — run `command` directly. Zero LLM tokens, deterministic, no
  judgment calls.
- **`agent-prompt`** — hand the `prompt` field to an LLM agent each run.
  Costs tokens, but can synthesize, prioritize, and draft prose.
- **`hybrid`** — ships both. You (or your agent) pick per run: `command` to
  save tokens and get raw data, or `prompt` when you want the LLM to
  interpret it. `script_note` on the job explains exactly what you trade
  away by choosing the script.

`{{placeholders}}` in `command`/`prompt` resolve from `variables`.

```yaml
id: dependency-audit
name: Dependency Vulnerability Audit
description: ...
category: devops
tags: [security, dependencies]
schedule: "0 8 * * 1"        # standard 5-field cron
timezone: "UTC"
runner: hybrid
command: |
  ...raw shell audit, zero tokens...
prompt: |
  ...instructions with {{repo_path}}, LLM synthesizes+prioritizes...
script_note: what you lose by using `command` instead of `prompt`
variables:
  repo_path:
    default: "."
    description: ...
compatible_agents: [claude, codex, hermes, openclaw, generic]
```

Full spec: [`schema/job.schema.json`](schema/job.schema.json).

## Using a job

1. Pick a job from `catalog.json` — check `modes` to see if it's script-only,
   agent-prompt-only, or both.
2. Decide script vs. agent-prompt if the job is `hybrid`: script saves
   tokens, agent-prompt gives you more detail/judgment (see `script_note`).
3. Override any `variables` and `schedule` for your case.
4. Hand `command` or `prompt` plus `schedule` to your scheduler — system
   crontab, a hosted cron, or your agent's own scheduling mechanism. This
   repo defines *what* to run and *when*, not the executor.

## Contributing a job

See [`CONTRIBUTING.md`](CONTRIBUTING.md) — copy `templates/job.template.yaml`,
fill it in, `npm run validate && npm run build-catalog`, open a PR.
