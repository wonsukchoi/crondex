# Context

**Current Task**: Growing crondex's job catalog and CLI. Latest published: `@wonsukchoi/crondex@0.8.0`, 150 jobs across 29 categories (all ≥3 jobs deep).

**Key Decisions**:
- `crondex recommend "<free text>"` added — zero-token weighted keyword match (tags/name+id/category/description) with naive plural stemming, for agents matching "can you do X" to an existing job before writing one from scratch.
- `scripts/build-catalog.js` now also syncs the job-count/category table in README.md between `<!-- BEGIN/END JOB SUMMARY -->` markers — fixes a bug where the README sat stale at "56 jobs" through 3 catalog-growth commits.
- Release pattern: add jobs -> `npm run build-catalog && npm run validate` -> commit -> bump `package.json` version -> `npm publish` (dry-run first).

**Next Steps**:
- CONTRIBUTING.md / job template doesn't mention `recommend` yet — update if contributors need to know about it.
- No test coverage beyond schema validation — fine for now (all jobs are inspectable shell/prompt text), revisit if `recommend`'s scoring logic grows more complex.
- Could keep deepening thin categories or add new ones — no fixed target, driven by user ask each session.
