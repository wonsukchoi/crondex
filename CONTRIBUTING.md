# Contributing a job

crondex is a directory, not a framework — a good contribution is one
well-formed YAML file plus a regenerated catalog. That's it.

## Steps

0. Check nobody already covers this:
   ```bash
   node bin/crondex.js recommend "<what your job would do>"
   ```
   If a close match exists, prefer improving it over adding a near-duplicate.

1. Copy the template — either by hand, or scaffold it:
   ```bash
   cp templates/job.template.yaml jobs/<category>/<id>.yaml
   # or:
   node bin/crondex.js init <id> --category <category> --dest jobs/<category>/<id>.yaml
   ```
   Use an existing category folder (`devops`, `productivity`) if your job
   fits, or create a new one — don't pre-plan the taxonomy, just add a
   folder when nothing existing fits.

2. Fill in the fields. Read the comments in the template, or the full spec
   at [`schema/job.schema.json`](schema/job.schema.json). Delete the
   template's comment lines when done.

3. Pick the right `runner`:
   - **`shell`** — the job is fully scriptable, no judgment calls needed
     (a health check, an expiry check, a cleanup). Zero tokens.
   - **`agent-prompt`** — the job needs synthesis, prioritization, drafting,
     or depends on a connector (email, calendar) too varied for one generic
     script.
   - **`hybrid`** — both a useful raw-data script *and* real value from an
     LLM pass exist. Hybrid jobs must include `script_note`: one or two
     sentences on what you lose by using `command` instead of `prompt`.

4. If your job takes any tunable value (a path, a threshold, a name), put
   it in `variables` with a sensible `default` — don't hardcode it into
   `command`/`prompt`.

5. Install deps once, then validate and rebuild the catalog:
   ```bash
   npm install
   npm run validate        # checks your job against the schema
   npm run lint-shell       # shellcheck over every shell/hybrid job's command (needs shellcheck on PATH)
   npm run build-catalog   # regenerates catalog.json — commit this too
   ```

6. Open a PR. CI re-runs all checks and fails if `catalog.json` is
   stale, a job doesn't match the schema, or a shell command doesn't pass
   shellcheck.

## Editing the CLI

If you're changing `bin/crondex.js` or `lib/recommend.js` rather than adding
a job, run `npm test` (Node's built-in test runner, `test/*.test.js`) — it
covers the `recommend` scoring/ranking logic specifically, since a silent
regression there would just look like slightly-worse search results, not a
crash.

## What makes a good job

- **Description written for a normal person, not an agent.** One sentence on
  what it does, one on when you'd want it ("Use this if you ..."). No
  jargon, no assuming the reader knows what cron is. This is the text
  someone browsing the catalog actually reads to decide if a job is for them.
- **Narrow and nameable.** "check X, alert if Y" beats "monitor everything."
- **Safe by default.** Destructive commands (deletes, sends, force-pushes)
  need a `notes` callout, and ideally a dry-run variable or draft-only mode
  (see `jobs/productivity/inbox-triage.yaml` for the draft-only pattern).
- **Portable.** Don't assume a specific OS/shell beyond POSIX + common CLIs
  (`curl`, `git`, `openssl`) unless you call that out in `notes`.
- **Honest about token cost.** If you're not sure whether a script mode is
  possible, look at how `jobs/devops/repo-health-check.yaml` or
  `jobs/devops/cost-alert.yaml` split raw-data-only vs. LLM-interpreted.

## Editing an existing job

Same validate/build-catalog steps, plus:

- Bump `version` by 1 if you change `prompt` or `command` in a way that
  changes behavior — different data pulled, different output, different
  side effects. This is how an agent that already scheduled the old version
  knows to re-check it.
- Don't bump `version` for wording-only edits (typos, clarifying a
  description, reformatting) that don't change what actually runs.
- Call out the behavior change in the PR description either way.
