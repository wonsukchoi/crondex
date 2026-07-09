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
   folder when nothing existing fits. If you do create a new category, add
   a one-line entry for it in
   [`lib/category-descriptions.js`](lib/category-descriptions.js) — `npm
   run build-catalog` warns (and `npm test` fails) if a category has no
   description.

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
   npm run validate          # checks your job against the schema
   npm run lint-shell        # shellcheck over every shell/hybrid job's command (needs shellcheck on PATH)
   npm run check-duplicates  # flags near-duplicate tag/description overlap with an existing job
   npm run build-catalog     # regenerates catalog.json — commit this too
   ```

6. Open a PR. CI re-runs all checks and fails if `catalog.json` is stale, a
   job doesn't match the schema, a shell command doesn't pass shellcheck, or
   a job looks like a near-duplicate of an existing one. That last one is a
   heuristic (tag + description overlap), not certainty — if it flags a
   pair that's genuinely distinct, say so in the PR description; it's a
   nudge for review, not an absolute rule.

## Editing the CLI or scripts

If you're changing `bin/crondex.js`, anything under `lib/`, or a script in
`scripts/`, run `npm test` (Node's built-in test runner, `test/*.test.js`).
Coverage: `recommend`/`rankJobs` scoring, near-duplicate detection
(`lib/duplicates.js`), the shellcheck placeholder-substitution logic
(`lib/shellcheck-prep.js`), catalog/README summary building
(`lib/catalog-summary.js`), category-description completeness, and CLI
integration tests that actually spawn `bin/crondex.js` for `list`/`show`/
`add`/`init`/`recommend`/`categories`. Most of these bugs would look like
"slightly worse output," not a crash — that's exactly what the tests exist
to catch.

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
