// MCP server exposing the read-only surface of the crondex catalog as tools —
// no filesystem writes, no crontab access. Reuses the same building blocks
// bin/crondex.js's CLI commands use (lib/recommend.js, lib/cron.js, js-yaml)
// and returns the same JSON shapes those commands already produce with --json,
// so agents already familiar with the CLI's output get identical data here.
//
// The one opt-in exception is crondex_deploy: it's only registered when the
// server is started with `crondex mcp --allow-deploy` (createServer({allowDeploy:
// true})). Even then it stays generation-only — it returns the same artifact
// text `deploy` would print, but never writes a file or touches crontab.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import yaml from "js-yaml";
import { tokenize, rankJobs } from "./recommend.js";
import { nextRuns } from "./cron.js";
import { CATEGORY_DESCRIPTIONS } from "./category-descriptions.js";
import {
  resolveVariables,
  substitutePlaceholders,
  pickMode,
  buildCrontabLine,
  buildGithubActionsWorkflow,
  buildSystemdUnits,
  buildDockerArtifacts,
  buildK8sCronJob,
  buildEventBridgeCommand,
  buildCloudSchedulerCommand,
} from "./deploy.js";

const DEPLOY_TARGETS = [
  "crontab",
  "github-actions",
  "systemd",
  "docker",
  "k8s-cronjob",
  "eventbridge",
  "cloud-scheduler",
];

const ROOT = fileURLToPath(new URL("..", import.meta.url));
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

export function createServer({ allowDeploy = false } = {}) {
  const server = new McpServer({ name: "crondex", version: PKG.version });

  server.registerTool(
    "crondex_recommend",
    {
      description:
        "Find the pre-made crondex job(s) that best match a plain-language description of a cron job you want. Zero tokens, no network call — offline keyword/synonym/fuzzy matching over the catalog. Check this before writing a new job from scratch.",
      inputSchema: {
        query: z
          .string()
          .describe('Plain-language description of what the job should do, e.g. "warn me before my SSL cert expires".'),
        limit: z.number().int().positive().max(20).optional().describe("Max number of matches to return (default 5)."),
      },
    },
    async ({ query, limit }) => {
      if (!tokenize(query).length) {
        return errorResult(
          "query too vague to match on — describe what you want the job to check or remind you about."
        );
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
      description:
        "Browse crondex jobs, optionally filtered by category and/or tag. Returns job metadata (not the full YAML — use crondex_show for that).",
      inputSchema: {
        category: z.string().optional().describe('Only return jobs in this category, e.g. "devops".'),
        tag: z.string().optional().describe("Only return jobs with this tag."),
      },
    },
    async ({ category, tag }) => {
      const jobs = CATALOG.jobs.filter((j) => (!category || j.category === category) && (!tag || j.tags.includes(tag)));
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
      description:
        "Get the full YAML definition (as JSON) of one crondex job by id, including its command/prompt, variables, and notes.",
      inputSchema: {
        id: z.string().describe('The job\'s id, e.g. "ssl-cert-expiry-check".'),
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
      description:
        "Compute the next N run times for a crondex job's schedule, in its declared timezone. Useful to sanity-check a schedule before deploying it. Zero tokens, no network call.",
      inputSchema: {
        id: z.string().describe("The job's id."),
        count: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe("How many upcoming run times to return (default 5)."),
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

  if (allowDeploy) {
    server.registerTool(
      "crondex_deploy",
      {
        description:
          "Generates a deployment artifact for a crondex job (a crontab line, GitHub Actions workflow, systemd service+timer pair, Dockerfile+crontab pair, k8s CronJob manifest, or aws/gcloud CLI command) — the same text `crondex deploy` would print. Generation only: does NOT write any files, does NOT install anything into crontab, and has no other side effects. Only registered when the server is started with `crondex mcp --allow-deploy`.",
        inputSchema: {
          id: z.string().describe("The job's id."),
          target: z.enum(DEPLOY_TARGETS).optional().describe('Deployment target (default "crontab").'),
          vars: z
            .record(z.string(), z.string())
            .optional()
            .describe("Variable overrides, same shape as repeated `deploy --var name=value` flags."),
          mode: z
            .enum(["script", "prompt"])
            .optional()
            .describe("For hybrid jobs, which side to deploy (default script)."),
        },
      },
      async ({ id, target, vars, mode }) => {
        const meta = findJob(id);
        if (!meta) return errorResult(`no job named "${id}". Run crondex_list or crondex_recommend to find one.`);
        const doc = yaml.load(readFileSync(join(ROOT, meta.path), "utf8"));
        doc.path = meta.path;

        const resolvedTarget = target ?? "crontab";
        const resolvedMode = pickMode(doc, mode);
        if (resolvedMode === "prompt" && !doc.prompt) {
          return errorResult(`"${id}" has no prompt to deploy (runner: ${doc.runner}). Try without mode "prompt".`);
        }
        if (resolvedMode === "script" && !doc.command) {
          return errorResult(`"${id}" has no command to deploy (runner: ${doc.runner}). Try mode "prompt".`);
        }

        const values = resolveVariables(doc, vars ?? {});
        const command = doc.command ? substitutePlaceholders(doc.command, values) : undefined;
        const prompt = doc.prompt ? substitutePlaceholders(doc.prompt, values) : undefined;
        const isPrompt = resolvedMode === "prompt";
        const text = isPrompt ? prompt : command;

        let artifacts;
        switch (resolvedTarget) {
          case "crontab":
            artifacts = buildCrontabLine(doc, text, isPrompt);
            break;
          case "github-actions":
            artifacts = buildGithubActionsWorkflow(doc, { command, prompt, mode: resolvedMode });
            break;
          case "systemd":
            artifacts = buildSystemdUnits(doc, text, isPrompt);
            break;
          case "docker":
            artifacts = buildDockerArtifacts(doc, text, isPrompt);
            break;
          case "k8s-cronjob":
            artifacts = buildK8sCronJob(doc, text, isPrompt);
            break;
          case "eventbridge":
            artifacts = buildEventBridgeCommand(doc, text, isPrompt);
            break;
          case "cloud-scheduler":
            artifacts = buildCloudSchedulerCommand(doc, text, isPrompt);
            break;
        }
        return textResult({ id, target: resolvedTarget, mode: resolvedMode, artifacts });
      }
    );
  }

  return server;
}

export async function startMcpServer(options = {}) {
  const server = createServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
