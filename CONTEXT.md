# Context

**Current Task**: Building crondex — public directory of pre-made, agent-editable cron jobs (YAML + catalog.json + CLI), with npm publish as the next step.

**Key Decisions**:
- Jobs use `runner: shell | agent-prompt | hybrid` — hybrid ships both a zero-token script and an LLM prompt so users pick token cost vs. detail (see `script_note`).
- `bin/crondex.js` CLI (list/show/add) is publish-ready; recommend `npx` over global install since it always pulls the latest catalog.
- MIT licensed; CI validates jobs + catalog freshness on every push/PR.

**Next Steps**:
- npm login confirmed (user: wonsukchoi), name `crondex` is free on the registry — still need: flip `private: true` off in package.json, `npm publish --dry-run` to review, then real `npm publish` after explicit confirmation.
- Consider adding content/personal job categories.
