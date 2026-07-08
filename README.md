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

## CLI

Published on npm as `@wonsukchoi/crondex` (the plain name `crondex` was
blocked by npm's anti-typosquat check). The command itself is still
`crondex` once installed — only the package name is scoped:

```bash
npx @wonsukchoi/crondex list                          # browse everything
npx @wonsukchoi/crondex list --category devops        # filter by category or --tag
npx @wonsukchoi/crondex show backup-reminder          # print one job's YAML
npx @wonsukchoi/crondex add backup-reminder --dest ./cron/backup-reminder.yaml
```

Or install once and drop the scope prefix on every call:

```bash
npm install -g @wonsukchoi/crondex
crondex list
```

`add` copies the job's YAML as-is into your project — it's yours to edit
from there. `npx` always pulls the latest published catalog; a global
install needs `npm update -g @wonsukchoi/crondex` to see new jobs (`crondex
list` prints a reminder either way).

A clone works too, no npm required:

```bash
git clone https://github.com/wonsukchoi/crondex.git && cd crondex
node bin/crondex.js list
```

## Layout

```
crondex/
├── bin/crondex.js         CLI: list / show / add
├── catalog.json           generated index of every job — read this first
├── schema/job.schema.json spec every job file follows
├── jobs/
│   ├── devops/
│   ├── productivity/
│   ├── personal/
│   ├── content/
│   ├── finance/
│   ├── security/
│   ├── learning/
│   ├── team/
│   ├── home/
│   ├── travel/
│   └── growth/
└── scripts/
    ├── build-catalog.js   regenerates catalog.json from jobs/**/*.yaml
    └── validate-jobs.js   validates every job against the schema
```

## Available jobs

56 jobs across 11 categories. Full details (description, tags, variables)
live in `catalog.json` and each job's YAML file — run `crondex list` or
browse `jobs/<category>/` for the plain-language rundown of each.

**devops**

| id | schedule | modes |
|---|---|---|
| `dependency-audit` | `0 8 * * 1` | script + agent-prompt |
| `log-cleanup` | `30 3 * * *` | script |
| `repo-health-check` | `0 9 * * 1-5` | script + agent-prompt |
| `backup-reminder` | `0 9 * * *` | script |
| `ssl-cert-expiry-check` | `0 6 * * *` | script |
| `uptime-ping-check` | `*/15 * * * *` | script |
| `cost-alert` | `0 7 * * *` | script + agent-prompt |
| `disk-space-check` | `0 */6 * * *` | script |
| `docker-image-prune` | `0 4 * * *` | script |
| `env-drift-check` | `0 8 * * *` | script |
| `stale-dependency-pr-nudge` | `0 9 * * 1-5` | script |
| `db-backup-verify` | `0 5 * * *` | script |
| `license-compliance-check` | `0 8 * * 1` | script |
| `orphaned-branch-cleanup` | `0 9 * * 1` | script |
| `dns-record-check` | `0 */6 * * *` | script |
| `queue-depth-check` | `*/10 * * * *` | script |
| `api-rate-limit-check` | `*/15 * * * *` | script |

**productivity**

| id | schedule | modes |
|---|---|---|
| `daily-standup-summary` | `0 8 * * 1-5` | script + agent-prompt |
| `inbox-triage` | `0 7,13 * * 1-5` | agent-prompt only |
| `weekly-report` | `0 16 * * 5` | script + agent-prompt |
| `focus-block-reminder` | `0 9,14 * * 1-5` | script |

**personal**

| id | schedule | modes |
|---|---|---|
| `bill-due-reminder` | `0 9 * * *` | script |
| `habit-checkin` | `0 20 * * *` | script |
| `meal-plan-reminder` | `0 9 * * 0` | script + agent-prompt |
| `water-intake-reminder` | `0 9,12,15,18 * * *` | script |
| `screen-time-check` | `0 20 * * *` | agent-prompt only |

**content**

| id | schedule | modes |
|---|---|---|
| `changelog-digest` | `0 10 * * 5` | script + agent-prompt |
| `broken-link-check` | `0 7 * * 1` | script |
| `social-mentions-watch` | `0 9 * * *` | agent-prompt only |
| `seo-meta-check` | `0 7 * * 1` | script |
| `rss-feed-validate` | `0 8 * * *` | script |
| `robots-txt-check` | `0 8 * * *` | script |

**finance**

| id | schedule | modes |
|---|---|---|
| `subscription-audit` | `0 9 1 * *` | script |
| `net-worth-snapshot` | `0 9 1 * *` | script |
| `saas-seat-audit` | `0 9 1 * *` | script |
| `invoice-overdue-check` | `0 9 * * *` | script |
| `tax-deadline-reminder` | `0 9 * * *` | script |

**security**

| id | schedule | modes |
|---|---|---|
| `secrets-scan` | `0 3 * * *` | script |
| `open-port-check` | `0 */4 * * *` | script |
| `failed-login-watch` | `*/15 * * * *` | script |
| `sudo-usage-audit` | `0 * * * *` | script |
| `firewall-rule-diff` | `0 6 * * *` | script |
| `certificate-transparency-watch` | `0 */12 * * *` | script |

**learning**

| id | schedule | modes |
|---|---|---|
| `daily-flashcard-review` | `0 8 * * *` | script |
| `reading-list-nudge` | `0 9 * * 6` | script |
| `course-progress-checkin` | `0 9 * * 1` | script |

**team**

| id | schedule | modes |
|---|---|---|
| `1on1-prep-reminder` | `0 9 * * 3` | script |
| `pto-balance-check` | `0 9 1 * *` | script |

**home**

| id | schedule | modes |
|---|---|---|
| `hvac-filter-reminder` | `0 9 1 * *` | script |
| `smoke-detector-battery-check` | `0 9 1 * *` | script |
| `plant-watering-reminder` | `0 9 * * *` | script |

**travel**

| id | schedule | modes |
|---|---|---|
| `passport-expiry-check` | `0 9 1 * *` | script |
| `visa-expiry-check` | `0 9 1 * *` | script |
| `flight-checkin-reminder` | `0 * * * *` | script |

**growth**

| id | schedule | modes |
|---|---|---|
| `review-request-nudge` | `0 9 * * *` | script |
| `cart-abandonment-followup` | `0 10 * * *` | script + agent-prompt |

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

`{{placeholders}}` in `command`/`prompt` resolve from `variables`. Each job
also carries a `version` — bumped whenever `prompt`/`command` behavior
changes, so if you've already scheduled a job elsewhere you can tell when
the upstream copy has moved on without you.

```yaml
id: dependency-audit
version: 1
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

## License

[MIT](LICENSE)
