<div align="center">

```
  ______________  ____  ____/ /__  _  __
 / ___/ ___/ __ \/ __ \/ __  / _ \| |/_/
 / /__/ /  / /_/ / / / / /_/ /  __/>  <
 \___/_/   \____/_/ /_/\__,_/\___/_/|_|
```

**Pre-made cron jobs any AI agent can pull, tweak, and schedule.**
A directory, not a framework.

[![npm version](https://img.shields.io/npm/v/@wonsukchoi/crondex.svg)](https://www.npmjs.com/package/@wonsukchoi/crondex)
[![npm downloads](https://img.shields.io/npm/dm/@wonsukchoi/crondex.svg)](https://www.npmjs.com/package/@wonsukchoi/crondex)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

Works with Claude, Codex, Hermes, OpenClaw, or any plain LLM with shell
access.

## Get a job

```bash
npx @wonsukchoi/crondex recommend "warn me before my SSL cert expires"
npx @wonsukchoi/crondex show ssl-cert-expiry-check
npx @wonsukchoi/crondex deploy ssl-cert-expiry-check --var host=example.com
```

- `recommend "<what you want>"` — find the closest matching job (zero
  tokens, no network call, so an agent can check before writing one from
  scratch). Matching handles plurals, a small catalog-grounded synonym set
  (e.g. "notify"/"warn"/"remind" all match jobs tagged `reminder`), and
  falls back to fuzzy (edit-distance) matching on typos when nothing
  matches exactly.
- `list [--category x] [--tag y]` / `categories` — browse everything
- `show <id>` — print a job's full YAML
- `next <id> [--count n]` — print the next N run times for a job's schedule,
  in its declared timezone (zero tokens, no network call) — sanity-check a
  schedule before deploying it
- `add <id> [--dest path]` — copy it into your project to edit
- `init <id> [--category x]` — scaffold a brand-new job from the template
- `update <path> [--dry-run]` — re-pull a job you already `add`ed/`init`ed
  (matched by its `id` field) against the current catalog, print a diff of
  what changed, and overwrite it in place. `--dry-run` shows the diff
  without applying it.
- `deploy <id> --target <crontab|github-actions|systemd|docker|k8s-cronjob|eventbridge|cloud-scheduler> [--var name=value ...]`
  — turn a job into something that actually runs (crontab line, GitHub
  Actions workflow, systemd timer, Dockerfile, k8s CronJob, or a ready
  `aws`/`gcloud` command). `--var` overrides a variable's default. `hybrid`
  jobs deploy `command` by default; add `--mode prompt` for the prompt side.
- `deploy --list-installed` — show every crondex-managed line in your
  crontab (the ones left by `--install`)
- `uninstall <id>` — remove one of those installed crontab entries

Add `--json` to `list`/`categories`/`show`/`recommend` for machine-readable
output — useful when an agent is parsing the result programmatically
instead of a human reading it.

No install needed — `npx` always runs against the latest catalog.

---

## Use as an MCP server

Skip the shell-out entirely — register crondex as an MCP server and your
agent gets `recommend`/`list`/`categories`/`show`/`next` as native tools
instead of invoking a CLI. Read-only: no filesystem writes, no crontab
access.

Claude Code:

```bash
claude mcp add crondex -- npx -y @wonsukchoi/crondex mcp
```

Any other MCP client (e.g. `.mcp.json`, Claude Desktop's config):

```json
{
  "mcpServers": {
    "crondex": {
      "command": "npx",
      "args": ["-y", "@wonsukchoi/crondex", "mcp"]
    }
  }
}
```

Tools exposed: `crondex_recommend`, `crondex_list`, `crondex_categories`,
`crondex_show`, `crondex_next_runs` — each returns the same JSON shape as
the matching CLI command's `--json` flag.

### Running it from a local clone (before it's published)

The `npx` commands above pull from npm — until this version is actually
published, point your MCP client at your local clone instead. Works the
same on macOS/Linux/WSL, just swap in your own path.

```bash
git clone https://github.com/wonsukchoi/crondex.git
cd crondex
npm install
```

Claude Code — point it straight at the local entrypoint (use the real
absolute path; `$(pwd)/bin/crondex.js` works from inside the repo):

```bash
claude mcp add crondex -- node "$(pwd)/bin/crondex.js" mcp
```

Any other MCP client (`.mcp.json`, Claude Desktop's config — on macOS
that's `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "crondex": {
      "command": "node",
      "args": ["/absolute/path/to/crondex/bin/crondex.js", "mcp"]
    }
  }
}
```

Editing a job YAML or `lib/mcp-server.js` takes effect on the next server
restart — no reinstall/relink needed, since the client is just running
your working tree directly. Restart the server (or reconnect the client)
after any change to pick it up.

Prefer a plain `crondex` command instead of a hardcoded path? Run `npm
link` once from the repo root — it symlinks a global `crondex` onto your
`PATH` pointing at this clone — then use `claude mcp add crondex --
crondex mcp` / `"command": "crondex", "args": ["mcp"]` instead. `npm
unlink -g @wonsukchoi/crondex` undoes it.

---

## What's in a job

Every job is one YAML file:

```yaml
id: dependency-audit
version: 1
name: Dependency Vulnerability Audit
category: devops
schedule: "0 8 * * 1"    # standard 5-field cron
runner: hybrid            # shell | agent-prompt | hybrid
command: |                 # for runner: shell/hybrid
  ...raw shell audit, zero tokens...
prompt: |                  # for runner: agent-prompt/hybrid
  ...instructions with {{repo_path}}, LLM synthesizes+prioritizes...
script_note: what you lose by using `command` instead of `prompt`
variables:
  repo_path:
    default: "."
compatible_agents: [claude, codex, hermes, openclaw, generic]
```

- **`shell`** — runs `command` only. Zero LLM tokens, deterministic.
- **`agent-prompt`** — hands `prompt` to an LLM each run. Costs tokens, but
  can synthesize, prioritize, and draft prose.
- **`hybrid`** — ships both, pick per run: script to save tokens, prompt for
  more judgment. `script_note` explains the tradeoff.

`{{placeholders}}` resolve from `variables` — override them for your case,
then hand `command`/`prompt` plus `schedule` to whatever scheduler you have
(system crontab, a hosted cron, your agent's own scheduling mechanism). This
repo defines *what* to run and *when*, not the executor. Full field spec:
[`schema/job.schema.json`](schema/job.schema.json).

---

## Browse the catalog

The table below is regenerated by `npm run build-catalog`, so it never
drifts from what's actually in `jobs/`. For full details (description,
tags, variables) use `crondex list`, `crondex recommend`, or browse
`jobs/<category>/` directly.

<!-- BEGIN JOB SUMMARY -->
1411 jobs across 60 categories:

| category | jobs | description |
|---|---|---|
| `agency` | 20 | Marketing/creative agency client-services ops — retainers, scopes, billing, review cycles, new business. |
| `agriculture` | 21 | Farm operations — weather risk, irrigation, equipment, market prices. |
| `automotive` | 20 | Dealership and repair shop ops — repair orders, parts, loaners, recalls, F&I, used inventory, CSI. |
| `childcare` | 32 | Daycare compliance and ops — ratios, immunizations, tuition. |
| `cleaning-services` | 20 | Commercial/residential cleaning and janitorial business ops — crew hours, background checks, missed cleans, damage claims, chemical safety. |
| `construction` | 21 | Job site ops — permits, RFIs, submittals, safety, payments, budget vs. actual. |
| `content` | 20 | Site/content health — SEO, broken links, freshness, repurposing. |
| `coworking` | 20 | Shared-workspace membership ops — desks, room booking, community, amenities. |
| `creator` | 20 | Influencer/creator ops — content calendar, cross-posting, sponsorships. |
| `crypto` | 20 | Wallets, gas prices, DeFi risk, and token unlock schedules. |
| `devops` | 38 | Infra health — backups, deploys, dependencies, monitoring. |
| `ecommerce` | 32 | Storefront ops — carts, stock, returns, reviews. |
| `education` | 20 | School/district ops — grading, attendance, IEP compliance, staffing, facilities, budget. |
| `events` | 21 | Event planning — budget, RSVPs, staffing, vendors, day-of check-in. |
| `fieldservice` | 20 | Dispatch ops — tech ETAs, parts, warranty claims, maintenance contracts. |
| `finance` | 36 | Personal/business finance — budgets, invoices, taxes, subscriptions. |
| `fitness` | 20 | Gym/studio ops — memberships, class utilization, equipment. |
| `fleet` | 20 | Company vehicle fleet ops — compliance, maintenance, safety, fuel, cost, scheduling. |
| `gaming` | 21 | Streaming and community server ops — schedules, patches, tournaments. |
| `government` | 32 | Public-sector ops — records requests, permits, constituent casework. |
| `growth` | 20 | Lifecycle marketing — churn, trials, onboarding, activation, expansion, retention, NPS. |
| `healthcare` | 33 | Clinic ops — appointments, recalls, licenses, lab results. |
| `hiring` | 32 | Recruiting pipeline — candidates, offers, interviews, reqs. |
| `home` | 20 | Household reminders — maintenance, warranties, plants, safety. |
| `hospitality` | 32 | Hotel ops — revenue management, reservations, housekeeping, guest experience, loyalty. |
| `hr` | 32 | People ops — payroll, onboarding, benefits, reviews, offboarding. |
| `insurance` | 32 | Policy & carrier ops — renewals, claims, underwriting, compliance. |
| `inventory` | 20 | Stock accuracy — counts, shrinkage, expiry, overstock. |
| `investing` | 20 | Portfolio tracking — prices, dividends, rebalancing, taxes. |
| `landscaping` | 20 | Lawn-care/grounds-maintenance business ops — crew routes, contracts, chemical logs, equipment. |
| `learning` | 20 | Personal learning — certs, courses, flashcards, reading. |
| `legal` | 20 | Contracts and deadlines — NDAs, trademarks, court, compliance filings. |
| `logistics` | 32 | Shipping ops — customs, freight, delays, fees. |
| `manufacturing` | 21 | Production ops — downtime, defects, maintenance, suppliers, materials. |
| `marketing` | 32 | Campaign ops — ad spend, ROAS, SEO rank, deliverability, attribution, competitors, MQLs, PR. |
| `moving-relocation` | 20 | Household/office moving company ops — crew dispatch, estimates, claims, DOT compliance, storage-in-transit. |
| `nonprofit` | 20 | Fundraising ops — grants, donors, volunteers, board follow-ups. |
| `personal` | 20 | Daily life reminders — bills, habits, meals, screen time. |
| `petcare` | 20 | Non-medical pet-services ops — grooming, boarding, daycare, kennel capacity. |
| `pharmacy` | 20 | Retail/independent pharmacy ops — script queue, controlled substances, refills, PBM claims. |
| `photography` | 20 | Photo/video studio ops — gallery delivery, releases, backups, licensing, retainers. |
| `podcast` | 20 | Show ops — publish cadence, guests, sponsors, ratings. |
| `productivity` | 20 | Work habits — inbox, standups, focus, meetings, reports. |
| `publishing` | 21 | Book/print ops — manuscript deadlines, royalties, print runs, rights. |
| `realestate` | 20 | Property management — leases, rent, vacancy, inspections, tax. |
| `restaurant` | 20 | Kitchen/FOH ops — food cost, labor cost, waste, inspections, POS, menu margins. |
| `retail` | 33 | Physical store ops — till reconciliation, checklists, scheduling, merchandising, loss prevention, pricing. |
| `sales` | 20 | Pipeline ops — leads, deals, quota, CRM sync. |
| `security` | 32 | Security posture — keys, certs, access, scans, firewalls. |
| `self-storage` | 20 | Self-storage facility ops — unit rentals, delinquent accounts/lien process, gate access, climate control. |
| `senior-living` | 20 | Assisted-living/memory-care facility ops — resident care, staffing ratios, family communication, safety. |
| `spa` | 20 | Salon/spa/wellness ops — no-shows, inventory, license renewals, membership churn. |
| `staffing` | 20 | Temp-staffing/PEO agency ops — placements, timesheets, client contracts, worker's comp. |
| `support` | 33 | Helpdesk ops — SLA, backlog, CSAT, agent workload. |
| `team` | 20 | Team ops — 1:1s, on-call, PTO, anniversaries. |
| `telecom` | 20 | ISP/telecom ops — outages, SLA uptime, circuit provisioning, churn. |
| `travel` | 20 | Trip logistics — flights, passports, visas, insurance, miles. |
| `utilities` | 20 | Electric/water/gas utility company ops — outages, meters, regulatory compliance, grid/network assets. |
| `veterinary` | 32 | Clinic ops for animals — vaccines, controlled substances, boarding, surgery scheduling, records, billing, licensing. |
| `warehousing` | 20 | Warehouse facility ops — dock scheduling, pick/pack, slotting, labor, maintenance, safety. |
<!-- END JOB SUMMARY -->

---

## Layout

```
crondex/
├── llms.txt               agent-discovery manifest (llms.txt convention)
├── bin/crondex.js         CLI: list / categories / show / add / recommend / init / update / deploy / uninstall
├── lib/                   recommend, deploy, diff, and catalog-building logic (unit tested in test/)
├── catalog.json           generated index of every job — read this first
├── schema/job.schema.json spec every job file follows
├── jobs/                  one YAML per job, grouped by category subdirectory
└── scripts/               build-catalog.js, validate-jobs.js, lint-shell.js, check-duplicates.js, smoke-test.js
```

---

## Contributing a job

See [`CONTRIBUTING.md`](CONTRIBUTING.md) — copy `templates/job.template.yaml`
(or run `crondex init`), fill it in, `npm run validate && npm run
build-catalog`, open a PR. See [`ROADMAP.md`](ROADMAP.md) for what's
prioritized right now and what's deliberately not built yet.

---

## License

[MIT](LICENSE)
