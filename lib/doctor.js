// Pure comparison logic for `crondex doctor` — audits crondex-managed crontab
// lines (as produced by `deploy --install`, matched the same way
// `deploy --list-installed`/`uninstall` do) against the current catalog.
// Kept side-effect-free (no crontab reads) so it's directly unit-testable;
// bin/crondex.js's doctor command (via lib/cli.js) reads the crontab and
// hands the resulting lines to auditInstalled.

const MARKER_RE = /# crondex:([^\s@]+)(?:@(\S+))?\s*$/;

// Parses one crondex-managed crontab line into {id, version, schedule, line}.
// `version` is undefined for lines installed before version tagging existed
// (unversioned `# crondex:<id>` marker) — see lib/deploy.js's crondexMarker.
export function parseInstalledLine(line) {
  const m = line.match(MARKER_RE);
  if (!m) return null;
  const [, id, versionRaw] = m;
  const version = versionRaw === undefined ? undefined : Number(versionRaw);
  const schedule = line.trim().split(/\s+/).slice(0, 5).join(" ");
  return { id, version, schedule, line };
}

// Compares every installed crondex-managed line against the catalog and
// returns one report entry per line that has an issue. Healthy lines are
// omitted entirely — an empty array means everything's fine.
//
// Issues reported (an entry can carry more than one):
//   - "orphaned"          the installed job id no longer exists in the catalog
//   - "schedule drift"    the installed line's schedule field no longer matches
//                          the catalog job's current schedule
//   - "version unknown"   the line predates version tagging — redeploy to tag it
//   - "outdated"          the installed version is older than the catalog's
export function auditInstalled(lines, catalogJobs) {
  const byId = new Map(catalogJobs.map((j) => [j.id, j]));
  const report = [];

  for (const line of lines) {
    const parsed = parseInstalledLine(line);
    if (!parsed) continue;
    const { id, version, schedule } = parsed;
    const job = byId.get(id);
    const issues = [];
    const details = [];

    if (!job) {
      issues.push("orphaned");
      details.push(`"${id}" is no longer in the catalog — run "crondex uninstall ${id}" to remove it.`);
    } else {
      if (job.schedule !== schedule) {
        issues.push("schedule drift");
        details.push(
          `installed schedule "${schedule}" differs from the catalog's "${job.schedule}" — redeploy to pick it up.`
        );
      }
      if (version === undefined) {
        issues.push("version unknown");
        details.push("installed before version tagging — redeploy to tag it.");
      } else if (job.version !== undefined && version < job.version) {
        issues.push("outdated");
        details.push(
          `installed version ${version} is behind the catalog's version ${job.version} — redeploy to update.`
        );
      }
    }

    if (issues.length) {
      report.push({ id, line, issues, detail: details.join(" ") });
    }
  }

  return report;
}
