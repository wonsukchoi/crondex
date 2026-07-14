// Integration tests that spawn `node bin/crondex.js mcp` as a real subprocess and
// talk to it over stdio via the SDK's own Client — same spirit as test/cli.test.js,
// which spawns bin/crondex.js directly for the plain-CLI commands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "bin/crondex.js");

async function withClient(fn) {
  const client = new Client({ name: "crondex-test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: "node", args: [CLI, "mcp"], cwd: ROOT });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function jsonOf(toolResult) {
  assert.equal(toolResult.isError, undefined, `expected success, got error: ${toolResult.content?.[0]?.text}`);
  return JSON.parse(toolResult.content[0].text);
}

test("tools/list: returns exactly the 5 expected tools", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "crondex_categories",
      "crondex_list",
      "crondex_next_runs",
      "crondex_recommend",
      "crondex_show",
    ]);
  });
});

test("crondex_recommend: a known-good query returns a confident match", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "crondex_recommend",
      arguments: { query: "warn me before my SSL cert expires" },
    });
    const matches = jsonOf(result);
    assert.ok(matches.length > 0);
    assert.equal(matches[0].id, "ssl-cert-expiry-check");
  });
});

test("crondex_recommend: a vague query returns an error result, not a crash", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "crondex_recommend", arguments: { query: "the" } });
    assert.equal(result.isError, true);
  });
});

test("crondex_show: matches `crondex show <id> --json`'s CLI output", async () => {
  const cliOut = execFileSync("node", [CLI, "show", "ssl-cert-expiry-check", "--json"], { encoding: "utf8" });
  await withClient(async (client) => {
    const result = await client.callTool({ name: "crondex_show", arguments: { id: "ssl-cert-expiry-check" } });
    assert.deepEqual(jsonOf(result), JSON.parse(cliOut));
  });
});

test("crondex_show: a bogus id returns an error result, not a crash", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "crondex_show", arguments: { id: "totally-not-a-real-job" } });
    assert.equal(result.isError, true);
  });
});

test("crondex_categories: returns every category in the catalog", async () => {
  const cliOut = JSON.parse(execFileSync("node", [CLI, "categories", "--json"], { encoding: "utf8" }));
  await withClient(async (client) => {
    const result = await client.callTool({ name: "crondex_categories", arguments: {} });
    assert.deepEqual(jsonOf(result), cliOut);
  });
});

test("crondex_list --category devops: only returns devops jobs", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "crondex_list", arguments: { category: "devops" } });
    const jobs = jsonOf(result);
    assert.ok(jobs.length > 0);
    assert.ok(jobs.every((j) => j.category === "devops"));
  });
});

test("crondex_next_runs: returns the requested count of future ISO timestamps", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "crondex_next_runs",
      arguments: { id: "ssl-cert-expiry-check", count: 3 },
    });
    const data = jsonOf(result);
    assert.equal(data.runs.length, 3);
    for (const iso of data.runs) assert.ok(new Date(iso).getTime() > Date.now());
  });
});
