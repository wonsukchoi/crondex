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
[![npm total downloads](https://img.shields.io/npm/dt/@wonsukchoi/crondex.svg)](https://www.npmjs.com/package/@wonsukchoi/crondex)
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
- `deploy <id> --target <crontab|github-actions|systemd|docker|k8s-cronjob|terraform|nomad|eventbridge|cloud-scheduler> [--var name=value ...]`
  — turn a job into something that actually runs (crontab line, GitHub
  Actions workflow, systemd timer, Dockerfile, k8s CronJob, Terraform
  `kubernetes_cron_job_v1` resource, or a ready `aws`/`gcloud` command).
  `--var` overrides a variable's default. `hybrid` jobs deploy `command` by
  default; add `--mode prompt` for the prompt side.
- `deploy --list-installed` — show every crondex-managed line in your
  crontab (the ones left by `--install`)
- `uninstall <id>` — remove one of those installed crontab entries
- `doctor [--json]` — audit installed crontab entries against the catalog:
  orphaned entries, schedule drift, and version tagging/staleness. Exits `1`
  if any issues were found.
- `bundle <file.yaml> [--target <target>] [--dry-run] [--out-dir <path>] [--install]`
  — deploy every job in a manifest in one shot (see [Bundles](#bundles))

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

Pass `--allow-deploy` (`crondex mcp --allow-deploy`, or add it to your MCP
client's args) to opt into one more tool: `crondex_deploy`. It takes the
same inputs as `crondex deploy` (`id`, `target`, `vars`, `mode`) and
returns the generated artifact text — a crontab line, workflow file,
systemd unit pair, etc. It's generation-only: it never writes a file,
never touches your crontab, and has no other side effect, so the server
stays safe to point an agent at even with `--allow-deploy` on. Without the
flag, `crondex_deploy` isn't registered at all.

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

## Bundles

Deploy several jobs in one shot with a manifest file:

```yaml
# bundle.yaml
jobs:
  - id: ssl-cert-expiry-check
    vars:
      host: example.com
      port: "443"
  - id: dependency-audit
    vars:
      repo_path: /srv/app
  - id: cost-alert
    mode: prompt
```

```bash
crondex bundle bundle.yaml --target crontab --dry-run   # preview
crondex bundle bundle.yaml --target crontab --install   # install every job
crondex bundle bundle.yaml --target github-actions --out-dir .github/workflows
```

Each entry supports `id` (required), `vars` (variable overrides, same shape
as `deploy --var`), and `mode` (`script`/`prompt`, for `hybrid` jobs).
`--target crontab` (the default) combines every job into one crontab line
per job; every other target either writes one file (or file pair, for
`systemd`/`docker`) per job to `--out-dir`, or — without `--out-dir` —
prints all the artifacts concatenated with `===` header separators.
`--dry-run` previews the combined output without installing or writing
anything.

---

## Browse the catalog

The table below is regenerated by `npm run build-catalog`, so it never
drifts from what's actually in `jobs/`. For full details (description,
tags, variables) use `crondex list`, `crondex recommend`, or browse
`jobs/<category>/` directly.

<!-- BEGIN JOB SUMMARY -->
2639 jobs across 66 categories (2251 smoke-tested clean):

| category | jobs | smoke-tested | description |
|---|---|---|---|
| `agency` | 35 | 32 | Marketing/creative agency client-services ops — retainers, scopes, billing, review cycles, new business. |
| `agriculture` | 41 | 34 | Farm operations — weather risk, irrigation, equipment, market prices. |
| `automotive` | 35 | 29 | Dealership and repair shop ops — repair orders, parts, loaners, recalls, F&I, used inventory, CSI. |
| `banking` | 35 | 35 | Retail/community bank and credit union ops — KYC/AML, dormant accounts, teller variance, reg reporting. |
| `childcare` | 43 | 38 | Daycare compliance and ops — ratios, immunizations, tuition. |
| `cleaning-services` | 35 | 28 | Commercial/residential cleaning and janitorial business ops — crew hours, background checks, missed cleans, damage claims, chemical safety. |
| `construction` | 41 | 34 | Job site ops — permits, RFIs, submittals, safety, payments, budget vs. actual. |
| `content` | 35 | 18 | Site/content health — SEO, broken links, freshness, repurposing. |
| `coworking` | 35 | 31 | Shared-workspace membership ops — desks, room booking, community, amenities. |
| `creator` | 35 | 24 | Influencer/creator ops — content calendar, cross-posting, sponsorships. |
| `crypto` | 42 | 21 | Wallets, gas prices, DeFi risk, and token unlock schedules. |
| `dental` | 51 | 51 | Dental practice ops — hygiene recall, claims, chart compliance, lab cases, production. |
| `devops` | 56 | 52 | Infra health — backups, deploys, dependencies, monitoring. |
| `ecommerce` | 35 | 27 | Storefront ops — carts, stock, returns, reviews. |
| `education` | 37 | 28 | School/district ops — grading, attendance, IEP compliance, staffing, facilities, budget. |
| `events` | 37 | 32 | Event planning — budget, RSVPs, staffing, vendors, day-of check-in. |
| `fieldservice` | 37 | 35 | Dispatch ops — tech ETAs, parts, warranty claims, maintenance contracts. |
| `finance` | 53 | 53 | Personal/business finance — budgets, invoices, taxes, subscriptions. |
| `fitness` | 37 | 33 | Gym/studio ops — memberships, class utilization, equipment. |
| `fleet` | 48 | 39 | Company vehicle fleet ops — compliance, maintenance, safety, fuel, cost, scheduling. |
| `gaming` | 37 | 27 | Streaming and community server ops — schedules, patches, tournaments. |
| `government` | 43 | 40 | Public-sector ops — records requests, permits, constituent casework. |
| `growth` | 37 | 30 | Lifecycle marketing — churn, trials, onboarding, activation, expansion, retention, NPS. |
| `healthcare` | 51 | 45 | Clinic ops — appointments, recalls, licenses, lab results. |
| `hiring` | 37 | 25 | Recruiting pipeline — candidates, offers, interviews, reqs. |
| `home` | 37 | 34 | Household reminders — maintenance, warranties, plants, safety. |
| `hospitality` | 42 | 35 | Hotel ops — revenue management, reservations, housekeeping, guest experience, loyalty. |
| `hr` | 51 | 45 | People ops — payroll, onboarding, benefits, reviews, offboarding. |
| `insurance` | 37 | 29 | Policy & carrier ops — renewals, claims, underwriting, compliance. |
| `inventory` | 37 | 34 | Stock accuracy — counts, shrinkage, expiry, overstock. |
| `investing` | 37 | 30 | Portfolio tracking — prices, dividends, rebalancing, taxes. |
| `landscaping` | 41 | 37 | Lawn-care/grounds-maintenance business ops — crew routes, contracts, chemical logs, equipment. |
| `law-firm` | 41 | 40 | Law firm practice management ops — trust accounting, conflict checks, matter deadlines, CLE, billing. |
| `learning` | 37 | 35 | Personal learning — certs, courses, flashcards, reading. |
| `legal` | 37 | 35 | Contracts and deadlines — NDAs, trademarks, court, compliance filings. |
| `logistics` | 50 | 35 | Shipping ops — customs, freight, delays, fees. |
| `manufacturing` | 41 | 38 | Production ops — downtime, defects, maintenance, suppliers, materials. |
| `marketing` | 37 | 27 | Campaign ops — ad spend, ROAS, SEO rank, deliverability, attribution, competitors, MQLs, PR. |
| `moving-relocation` | 37 | 34 | Household/office moving company ops — crew dispatch, estimates, claims, DOT compliance, storage-in-transit. |
| `nonprofit` | 37 | 32 | Fundraising ops — grants, donors, volunteers, board follow-ups. |
| `payments` | 32 | 29 | Payment processor/merchant acquirer ops — chargebacks, disputes, settlement, PCI, KYB, funding. |
| `personal` | 37 | 33 | Daily life reminders — bills, habits, meals, screen time. |
| `petcare` | 37 | 33 | Non-medical pet-services ops — grooming, boarding, daycare, kennel capacity. |
| `pharmacy` | 50 | 42 | Retail/independent pharmacy ops — script queue, controlled substances, refills, PBM claims. |
| `photography` | 37 | 35 | Photo/video studio ops — gallery delivery, releases, backups, licensing, retainers. |
| `podcast` | 37 | 27 | Show ops — publish cadence, guests, sponsors, ratings. |
| `productivity` | 37 | 27 | Work habits — inbox, standups, focus, meetings, reports. |
| `publishing` | 37 | 34 | Book/print ops — manuscript deadlines, royalties, print runs, rights. |
| `realestate` | 37 | 37 | Property management — leases, rent, vacancy, inspections, tax. |
| `restaurant` | 41 | 30 | Kitchen/FOH ops — food cost, labor cost, waste, inspections, POS, menu margins. |
| `retail` | 37 | 31 | Physical store ops — till reconciliation, checklists, scheduling, merchandising, loss prevention, pricing. |
| `sales` | 37 | 31 | Pipeline ops — leads, deals, quota, CRM sync. |
| `security` | 51 | 44 | Security posture — keys, certs, access, scans, firewalls. |
| `self-storage` | 37 | 36 | Self-storage facility ops — unit rentals, delinquent accounts/lien process, gate access, climate control. |
| `senior-living` | 41 | 40 | Assisted-living/memory-care facility ops — resident care, staffing ratios, family communication, safety. |
| `short-term-rental` | 37 | 29 | Airbnb/VRBO/vacation-rental host ops — turnover cleaning, calendar/pricing sync, guest screening, deposits, permits, occupancy tax. |
| `spa` | 37 | 35 | Salon/spa/wellness ops — no-shows, inventory, license renewals, membership churn. |
| `staffing` | 41 | 35 | Temp-staffing/PEO agency ops — placements, timesheets, client contracts, worker's comp. |
| `support` | 51 | 38 | Helpdesk ops — SLA, backlog, CSAT, agent workload. |
| `team` | 51 | 50 | Team ops — 1:1s, on-call, PTO, anniversaries. |
| `telecom` | 37 | 32 | ISP/telecom ops — outages, SLA uptime, circuit provisioning, churn. |
| `travel` | 37 | 32 | Trip logistics — flights, passports, visas, insurance, miles. |
| `utilities` | 37 | 33 | Electric/water/gas utility company ops — outages, meters, regulatory compliance, grid/network assets. |
| `veterinary` | 41 | 32 | Clinic ops for animals — vaccines, controlled substances, boarding, surgery scheduling, records, billing, licensing. |
| `warehousing` | 41 | 33 | Warehouse facility ops — dock scheduling, pick/pack, slotting, labor, maintenance, safety. |
| `waste-management` | 37 | 32 | Waste hauling, recycling, and landfill/transfer-station ops — routes, contamination, tonnage, permits, billing. |
<!-- END JOB SUMMARY -->

---

## Layout

```
crondex/
├── llms.txt               agent-discovery manifest (llms.txt convention)
├── bin/crondex.js         thin CLI entry point — parsing/routing lives in lib/cli.js
├── lib/                   cli, doctor, bundle, recommend, deploy, diff, and catalog-building logic (unit tested in test/)
├── catalog.json           generated index of every job — read this first
├── schema/job.schema.json spec every job file follows
├── jobs/                  one YAML per job, grouped by category subdirectory
└── scripts/               build-catalog.js, validate-jobs.js, lint-shell.js, check-duplicates.js, smoke-test.js
```

---

## Contributing a job

See [`CONTRIBUTING.md`](CONTRIBUTING.md) — copy `templates/job.template.yaml`
(or run `crondex init`), fill it in, `npm run validate && npm run
build-catalog`, open a PR. If you're touching JS in `bin/`, `lib/`,
`scripts/`, or `test/`, run `npm run format` and `npm run lint`
([Biome](https://biomejs.dev/)) — CI runs the same lint check. See
[`ROADMAP.md`](ROADMAP.md) for what's prioritized right now and what's
deliberately not built yet.

---

## License

[MIT](LICENSE)
