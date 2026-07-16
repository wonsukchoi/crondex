# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `deploy --target nomad`: generates a Nomad periodic batch job spec,
  mirroring the `terraform` target's structure and reusing its
  `hclString()` HCL2 escaping as-is. Wired into `deploy`, `bundle`, and
  the `crondex_deploy` MCP tool.
- `SECURITY.md` and `.github/dependabot.yml` (npm + GitHub Actions,
  weekly).
- `scripts/check-smoke-sync.js` / `npm run check-smoke-sync`: advisory,
  non-blocking check that flags a changed shell/hybrid job whose
  `smoke-test-status.json` entry doesn't match its current `version`.
  Wired into `pr-jobs.yml`'s PR comment.

### Changed

- `scripts/verify-deploy-artifacts.js` now also checks: the `nomad`
  target (same structural HCL-escaping invariant proven on `terraform`)
  and a `shell-body` check (crontab/systemd/docker's shared embedded-
  command escaping, previously only unit-tested with synthetic cases,
  now checked against all 2182 real catalog jobs via `bash -n`).
- `lib/deploy.js`'s `buildShellBody()` is now exported (was
  internal-only) so it's directly checkable and reusable.

## [0.72.0] - 2026-07-16

### Added

- `deploy --target terraform` (ROADMAP §1's last open item): generates a
  `kubernetes_cron_job_v1` Terraform resource, mirroring `k8s-cronjob`
  field-for-field — same "actually runs the job" philosophy, HCL syntax
  instead of YAML. Wired into `deploy`, `bundle`, and the `crondex_deploy`
  MCP tool.
- `scripts/verify-deploy-artifacts.js` now also checks the `terraform`
  target: a tool-free structural invariant (every `${`/`%{` in the
  generated HCL must be part of the doubled `$${`/`%%{` escape) that
  runs unconditionally, plus `terraform fmt -check` when the `terraform`
  binary is on `PATH` (gracefully skipped otherwise, matching
  `lint-shell`'s shellcheck-optional precedent).

### Fixed

- The HCL string escaper's first version used `"$${"` as a
  `String.replace()` replacement string, intending to produce a literal
  `$${`. `$$` in a JS replacement string is itself a special escape for
  one literal `$`, so the replacement silently collapsed back to `${` —
  a no-op that would have shipped broken Terraform output for any job
  whose command contains bash's `${VAR:-default}` parameter expansion
  (roughly 5% of the catalog, by exact count at the time). Caught before
  release by a unit test asserting the *exact* escaped output rather
  than just "doesn't throw," and independently confirmed against all
  2182 catalog jobs by the new `verify-deploy-artifacts` check above.
  Fixed: `"$$$${"` (four `$` in the replacement string collapse pairwise
  to the two literal ones needed).

## [0.71.0] - 2026-07-16

### Added

- Trust/provenance signal (ROADMAP §2): `smoke-test-status.json` (new,
  committed) tracks each job's last successful `npm run smoke-test` run.
  `build-catalog` embeds `verified: boolean` into every `catalog.json`
  entry — true only when the job's current `version` matches what was
  last smoke-tested clean, so an edited-but-not-retested job correctly
  reads as unverified again. Surfaced in `list`/`show`/`recommend`
  output (both CLI and the matching MCP tools) with a `--verified-only`
  / `verified_only` filter, and in the README's per-category job table.
  First real run: 1836/2182 jobs (84%) smoke-tested clean — the
  remaining 346 are `agent-prompt`-only jobs with no shell command to
  smoke-test, not failures.
- `lib/smoke-test.js`: `updateSmokeStatus`/`isVerified`, the pure logic
  behind the above (unit tested independent of file I/O).

### Fixed

- `llms.txt` said "30+ categories" (stale — actual count is 64) and
  never mentioned the MCP server at all, despite ROADMAP §3 explicitly
  flagging the MCP server as an underexploited discovery channel. Now
  accurate, with an MCP section, and mentions the new `verified` field.
- `package.json` had no `mcp`/`mcp-server`/`model-context-protocol`
  keyword, making the package invisible to npm searches for MCP
  servers. Added those plus `llm`, and mentioned MCP in the description.

## [0.70.0] - 2026-07-16

### Added

- `npm run verify-deploy-artifacts` (`scripts/verify-deploy-artifacts.js`),
  wired into CI. Checks the *generated deploy artifact* itself — not the
  job's own command, `smoke-test`'s job — actually parses: k8s-cronjob
  and github-actions YAML round-trips through `js-yaml` with the
  expected shape, eventbridge/cloud-scheduler snippets have valid bash
  syntax. Cheap and deterministic (no network calls), unlike
  `smoke-test`, so it's a real CI gate. Verified against all 2182
  catalog jobs: 0 failures.

### Fixed

- `deploy --target github-actions`: `name: ${job.name}` was emitted as
  a bare YAML plain scalar. `job.name` has no schema restriction (just
  `type: string`), so a name containing a colon, a leading YAML
  indicator character (`#`, `-`, `"`, ...), or a raw newline would
  produce invalid YAML. No catalog job currently has such a name, but
  user-authored jobs aren't restricted either — this is exactly the
  kind of bug `verify-deploy-artifacts` above exists to catch. Now
  properly quoted. `deploy --target systemd`'s `Description=` lines get
  a matching defensive fix (embedded newlines collapsed to spaces,
  since a raw newline would split a unit-file value across invalid
  extra lines).

- `deploy --target systemd`: weekday and numeric cron ranges (e.g. `1-5`,
  `1-15`) now translate to systemd's `..` range syntax instead of a bare
  `-`, which systemd's calendar parser doesn't accept as a range
  operator (it's reserved as the date-literal separator, e.g.
  `2012-10-10`). Every generated `OnCalendar=` line with a day-of-week
  or numeric range was previously invalid — affects roughly 280 of 2182
  catalog jobs whose schedule uses a range in any field.
- `deploy --target eventbridge`: numeric ranges (day-of-month, month,
  hour, minute) now correctly keep cron's `-` — AWS's own dialect uses
  the opposite convention from systemd here. (This was a regression
  introduced and caught within the same unpublished pre-release: the
  systemd fix above initially shared its range-rewriting function with
  the AWS translator.)
- `deploy --target eventbridge`: a schedule that restricts both
  day-of-month and day-of-week (cron/Vixie semantics: OR — "on the
  15th, or any Friday") now throws a clear error instead of silently
  discarding the day-of-month restriction. AWS's `cron()` grammar
  requires exactly one of the two to be `?` and has no way to express
  the OR case. No catalog job currently hits this, but the CLI accepts
  arbitrary user-authored jobs, not just catalog ones.

All three found and fixed by auditing `lib/deploy.js` per-target for
cron expressions that don't translate cleanly (verified against all
2182 catalog job schedules, zero translation errors on either target
after the fixes).

## [0.64.0] - 2026-07-15

### Added

- Deepened `support`: +12 jobs (33 -> 45) — CSAT detractor follow-up,
  onboarding ticket SLA, macro effectiveness, support tool outage
  impact, proactive outage notification lag, shift coverage gaps,
  ticket merge/duplicate rate, cost-per-ticket trend, survey fatigue
  opt-out rate, internal-note leak check, renewal-risk escalation, KB
  article negative feedback spike. Catalog now 2056 jobs across 62
  categories.

## [0.63.0] - 2026-07-15

### Added

- Deepened `healthcare`: +12 jobs (33 -> 45) — 30-day readmission risk,
  nurse staffing ratio, discharge medication reconciliation, adverse
  drug event reporting lag, fall risk reassessment, HAI surveillance
  gaps, critical supply backorders, standing consent expiry, bed
  turnover time, claim write-off approval, state immunization registry
  reporting lag, peer review case lag. Catalog now 2044 jobs across 62
  categories.

## [0.62.0] - 2026-07-15

### Added

- New `banking` category: 32 bank/credit-union operations jobs
  (KYC/AML/BSA compliance, SAR/CTR filing, dormant accounts,
  teller/vault cash controls, Reg CC/DD/E compliance, loan covenants
  and turnaround, escheatment precursors, fraud holds). Distinct from
  `finance` (own-business bookkeeping) and `investing`
  (portfolio/brokerage). Catalog now 2032 jobs across 62 categories.

## [0.61.0] - 2026-07-15

### Added

- Deepened `finance`: +12 jobs (36 -> 48) — PO/invoice three-way match,
  bank signatory review, capex budget, journal entry approval lag,
  fixed asset disposal reconciliation, credit note approval, treasury
  cash sweep execution, vendor payment terms drift, VAT/GST filing
  deadlines, stale outstanding checks, budget transfer approval,
  duplicate vendor records. Catalog now 2000 jobs across 61 categories.

## [0.60.0] - 2026-07-15

### Added

- Deepened `devops`: +12 jobs (38 -> 50) — secrets rotation, orphaned
  cloud resources, on-call handoff checklist, postmortem action items,
  container image scan staleness, unused API key cleanup, domain
  registration expiry, status page incident staleness, SLO error-budget
  burn rate, load test baseline regression, database index bloat, CDN
  bandwidth anomaly. Catalog now 1988 jobs across 61 categories.

## [0.59.0] - 2026-07-15

### Added

- Deepened `dental`: +12 jobs (32 -> 44) — schedule utilization,
  HSA/FSA reimbursement tracking, payer recredentialing, recall-campaign
  contact gaps, x-ray retake rate, financing follow-up, online booking
  abandonment, NPI registry staleness, instrument tray turnaround,
  denture reline, pediatric fluoride consent expiry, emergency slot
  utilization. Catalog now 1976 jobs across 61 categories.

## [0.58.0] - 2026-07-15

### Added

- New `dental` category: 32 dental-practice-ops jobs (hygiene recall
  cadence, CDT-code claim denials, sterilization/calibration compliance,
  PPO fee schedule drift, lab case turnaround/remake rate, treatment plan
  follow-up, and related front-desk/billing checks). Catalog now 1964
  jobs across 61 categories.

### Changed

- CI runner Node version bumped 20 -> 22 across all workflows (GitHub is
  deprecating Node 20 runners). `package.json` `engines` floor stays
  `>=18`.

## [0.57.0] - 2026-07-15

### Added

- 24 new jobs across 20 categories; every category now holds at least 32
  jobs, enforced in CI by the new `npm run check-category-floor` gate
  (`scripts/check-category-floor.js`, floor overridable via
  `CRONDEX_CATEGORY_FLOOR`). Catalog now 1932 jobs across 60 categories.
- k8s CronJob deploy target emits the native `spec.timeZone` field
  (Kubernetes 1.27+) when a job declares a `timezone`.
- `crondex recommend`: 8 new catalog-grounded synonym groups
  (certificate/certification, license/permit, warranty/guarantee,
  subscription/membership, vendor/supplier, credential/password/access,
  capacity/utilization/occupancy, headcount/staffing/roster), plus
  renewal/lapse merged into the expiry group and archive into backup.
- PR validation workflow (`.github/workflows/pr-jobs.yml`): PRs touching
  `jobs/**` get schema/shellcheck/duplicate checks with a pass/fail
  summary comment.
- Static catalog site generator (`npm run build-site`) with client-side
  search, category filter, and per-job detail view; deployed to GitHub
  Pages on push to main (`.github/workflows/deploy-site.yml`).

- Biome lint + format for `bin/`, `lib/`, `scripts/`, and `test/`
  (`biome.json`, pinned `@biomejs/biome` dev dependency). `npm run lint`
  (`biome check .`) and `npm run format` (`biome format --write .`); lint
  is wired into CI (`.github/workflows/validate.yml`). `useTemplate`,
  `noUnusedFunctionParameters`, and `noTemplateCurlyInString` are disabled
  — they fired on existing idiomatic patterns (`str + "\n"` joins, the
  uniform `(positional, flags)` `COMMANDS` dispatch signature, and a
  literal `${job.id}` inside a systemd comment string) rather than real
  bugs.
- `crondex doctor [--json]` — audits installed crontab entries against the
  catalog: flags orphaned entries (job id no longer in the catalog),
  schedule drift (installed schedule no longer matches the catalog's), and
  entries installed before version tagging or older than the catalog's
  current version. Exits `1` if any issues were found. Comparison logic
  lives in `lib/doctor.js`.
- `crondex bundle <file.yaml> [--target <target>] [--dry-run] [--out-dir <path>] [--install]`
  — deploys every job listed in a manifest in one shot, reusing
  `lib/deploy.js`'s per-job resolution. See README's "Bundles" section for
  the manifest format. Logic lives in `lib/bundle.js`.
- `crondex deploy --install`/`crondex bundle --install` (crontab target)
  now tag the installed comment marker with the job's catalog version —
  `# crondex:<id>@<version>` — so `doctor` can detect staleness. Markers
  without a version are still parsed for backward compatibility with
  previously installed entries.
- `crondex_deploy` MCP tool, opt-in via `crondex mcp --allow-deploy`.
  Generates the same artifact text `crondex deploy` would print for a job
  (crontab line, GitHub Actions workflow, systemd unit pair, etc.) but
  never writes a file or touches crontab — generation only. Not
  registered unless `--allow-deploy` is passed.
- Argument parsing and command routing extracted from `bin/crondex.js`
  into `lib/cli.js` (`parseArgs`, `COMMANDS` dispatch table, `runCli`) —
  `bin/crondex.js` is now a thin shim. Unit-tested directly in
  `test/cli-unit.test.js` without spawning a subprocess.

## [0.56.1] - 2026-07-15

### Fixed

- `ROOT` path resolution (`lib/mcp-server.js`, `bin/crondex.js`, and every
  `scripts/*.js`/`test/*.test.js` file that derived it) used
  `new URL("..", import.meta.url).pathname`, which breaks on Windows and on
  any path containing percent-encoded characters. Replaced with
  `fileURLToPath(new URL("..", import.meta.url))`.
- `lib/deploy.js`'s weekday translators (`translateWeekdayField` for
  systemd, the day-of-week handling in `cronToAwsCron`) silently
  mistranslated cron's `a-b/n` step-in-range day-of-week syntax (e.g.
  `1-5/2`) instead of rejecting it — `Number("1-5/2")` is `NaN`, producing
  the literal string `"undefined"` in the generated schedule. Both now
  throw a clear error instead.
- `scripts/lint-shell.js` reused a single fixed temp filename
  (`check.sh`) for every job's shellcheck run, which could race under
  parallel invocations. Each job now gets a unique filename within the
  run's `mkdtemp`-created directory.

### Documentation

- Removed the stale "Running it from a local clone (before it's
  published)" section from `README.md` — the package is published on npm.
- `ROADMAP.md`'s catalog stats line is now auto-generated by
  `npm run build-catalog` (between `<!-- BEGIN CATALOG STATS -->` /
  `<!-- END CATALOG STATS -->` markers) instead of hand-maintained, and CI's
  freshness gate now also checks `ROADMAP.md` (and `README.md`) for drift,
  not just `catalog.json`.
- `CONTRIBUTING.md` now documents that the crt.sh-dependent smoke-test job
  needs `CRONDEX_SMOKE_TIMEOUT=35`.

## [0.56.0]

Current state of the project at this release:

- **Catalog**: 1908 jobs across 60 categories, each YAML-defined under
  `jobs/<category>/`, indexed in generated `catalog.json`.
- **CLI** (`bin/crondex.js`): `list`, `categories`, `show`, `next`, `add`,
  `init`, `recommend` (offline keyword/synonym/fuzzy matching, zero
  tokens, no network call), `update` (diff + `--dry-run`), `deploy`,
  `deploy --list-installed`, `uninstall`.
- **MCP server** (`lib/mcp-server.js`, `crondex mcp`): read-only tool
  surface — `crondex_recommend`, `crondex_list`, `crondex_categories`,
  `crondex_show`, `crondex_next_runs` — mirroring the CLI's `--json`
  output shapes, with no filesystem writes or crontab access.
- **Deploy targets** (`lib/deploy.js`, 7 total): crontab, GitHub Actions,
  systemd, Docker, k8s CronJob, EventBridge Scheduler, Cloud Scheduler.
- **Quality gates**: JSON-schema validation (`npm run validate`),
  shellcheck over every shell/hybrid job's command (`npm run lint-shell`),
  near-duplicate detection (`npm run check-duplicates`), a local
  sandboxed smoke test (`npm run smoke-test`), and catalog/README
  freshness checks — schema, unit tests, lint-shell, and duplicate
  detection run in CI; smoke-test stays local-only (network-dependent job
  defaults).
