// MCP server exposing the read-only surface of the crondex catalog as tools —
// no filesystem writes, no crontab access. Reuses the same building blocks
// bin/crondex.js's CLI commands use (lib/recommend.js, lib/cron.js, js-yaml)
// and returns the same JSON shapes those commands already produce with --json,
// so agents already familiar with the CLI's output get identical data here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import yaml from "js-yaml";
import { tokenize, rankJobs } from "./recommend.js";
import { nextRuns } from "./cron.js";
import { CATEGORY_DESCRIPTIONS } from "./category-descriptions.js";

const ROOT = new URL("..", import.meta.url).pathname;
const CATALOG = JSON.parse(readFileSync(join(ROOT, "catalog.json"), "utf8"));
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

function findJob(id) {
  return CATALOG.jobs.find((j) => j.id === id);
}

export function createServer() {
  const server = new McpServer({ name: "crondex", version: PKG.version });

  server.registerTool(
    "crondex_recommend",
    {
      description:
        "Find the pre-made crondex job(s) that best match a plain-language description of a cron job you want. Zero tokens, no network call — offline keyword/synonym/fuzzy matching over the catalog. Check this before writing a new job from scratch.",
      inputSchema: {
        query: z.string().describe("Plain-language description of what the job should do, e.g. \"warn me before my SSL cert expires\"."),
        limit: z.number().int().positive().max(20).optional().describe("Max number of matches to return (default 5)."),
      },
    },
    async ({ query, limit }) => {
      if (!tokenize(query).length) {
        return errorResult("query too vague to match on — describe what you want the job to check or remind you about.");
      }
      const ranked = rankJobs(CATALOG.jobs, query, limit ?? 5);
      if (!ranked.length) {
        return errorResult(`no confident match for "${query}". Try crondex_list to browse everything.`);
      }
      return textResult(
        ranked.map((r) => ({
          id: r.job.id,
          category: r.job.category,
          score: r.score,
          matched_terms: r.matchedTerms,
          modes: r.job.modes,
          description: r.job.description,
        }))
      );
    }
  );

  server.registerTool(
    "crondex_list",
    {
      description: "Browse crondex jobs, optionally filtered by category and/or tag. Returns job metadata (not the full YAML — use crondex_show for that).",
      inputSchema: {
        category: z.string().optional().describe("Only return jobs in this category, e.g. \"devops\"."),
        tag: z.string().optional().describe("Only return jobs with this tag."),
      },
    },
    async ({ category, tag }) => {
      const jobs = CATALOG.jobs.filter(
        (j) => (!category || j.category === category) && (!tag || j.tags.includes(tag))
      );
      return textResult(jobs);
    }
  );

  server.registerTool(
    "crondex_categories",
    {
      description: "List every crondex job category with its job count and a one-line description.",
      inputSchema: {},
    },
    async () => {
      const counts = {};
      for (const j of CATALOG.jobs) counts[j.category] = (counts[j.category] ?? 0) + 1;
      const sorted = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
      return textResult(
        sorted.map(([cat, count]) => ({ category: cat, count, description: CATEGORY_DESCRIPTIONS[cat] ?? "" }))
      );
    }
  );

  server.registerTool(
    "crondex_show",
    {
      description: "Get the full YAML definition (as JSON) of one crondex job by id, including its command/prompt, variables, and notes.",
      inputSchema: {
        id: z.string().describe("The job's id, e.g. \"ssl-cert-expiry-check\"."),
      },
    },
    async ({ id }) => {
      const meta = findJob(id);
      if (!meta) return errorResult(`no job named "${id}". Run crondex_list or crondex_recommend to find one.`);
      const raw = readFileSync(join(ROOT, meta.path), "utf8");
      return textResult(yaml.load(raw));
    }
  );

  server.registerTool(
    "crondex_next_runs",
    {
      description: "Compute the next N run times for a crondex job's schedule, in its declared timezone. Useful to sanity-check a schedule before deploying it. Zero tokens, no network call.",
      inputSchema: {
        id: z.string().describe("The job's id."),
        count: z.number().int().positive().max(50).optional().describe("How many upcoming run times to return (default 5)."),
      },
    },
    async ({ id, count }) => {
      const meta = findJob(id);
      if (!meta) return errorResult(`no job named "${id}". Run crondex_list or crondex_recommend to find one.`);
      const doc = yaml.load(readFileSync(join(ROOT, meta.path), "utf8"));
      const timezone = doc.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      let runs;
      try {
        runs = nextRuns(doc.schedule, { timezone, count: count ?? 5 });
      } catch (e) {
        return errorResult(`can't compute next runs for "${id}": ${e.message}`);
      }
      return textResult({ id, schedule: doc.schedule, timezone, runs: runs.map((d) => d.toISOString()) });
    }
  );

  return server;
}

export async function startMcpServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
