# Context

**Current Task**: Deepening crondex's richest categories instead of uniform +1 batches. Published `@wonsukchoi/crondex@0.22.0`, 463 jobs across 48 categories.

**Key Decisions**:
- Widened 4 new categories this session (fieldservice, telecom, publishing, spa), then deep-dove 7 already-existing ones with real wide surface: ecommerce 7→20, hr 7→19, healthcare 7→20, finance 10→24, legal 7→19, realestate 7→20, sales 7→18.
- Deep-dive pattern: one agent per category, reads existing jobs + adjacent categories first to avoid overlap, then writes 10-14 new jobs; near-duplicates get judged case-by-case and allowlisted in `lib/duplicates-allowlist.js` if genuinely distinct (3 pairs now).
- Fixed `npm test` CI flake twice: first scoped `node --test` to `test/*.test.js` (it was auto-discovering `scripts/smoke-test.js` and running full network smoke sweep every CI run), then had to unquote the glob (`node --test test/*.test.js` not `"test/*.test.js"`) since Node 20 (pinned in CI) doesn't support Node's own internal glob resolution the way Node 22 does locally — quoting suppressed shell expansion and broke it.

**Next Steps**:
- Remaining thin (7-job) categories not yet deep-dived: agriculture, automotive, childcare, construction, creator, crypto, education, events, fieldservice, fitness, fleet, gaming, government, growth, home, hospitality, insurance, inventory, investing, learning, logistics, manufacturing, marketing, nonprofit, podcast, publishing, restaurant, retail, spa, support, team, telecom, travel, veterinary, warehousing — pick next by real-world job surface, same agent-per-category deep-dive pattern.
- CONTRIBUTING.md doesn't mention the deep-dive pattern or duplicates-allowlist review process yet.
- Watch CI after any future npm-scripts change — the Node-version-glob-support gap bit twice this session.
