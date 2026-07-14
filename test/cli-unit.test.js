// Unit tests for lib/cli.js's argument parser and dispatch table — these run
// in-process (no subprocess spawn), unlike test/cli.test.js's integration
// tests which exercise bin/crondex.js end-to-end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, COMMANDS } from "../lib/cli.js";

test("parseArgs: plain command with no flags", () => {
  const { command, positional, flags } = parseArgs(["list"]);
  assert.equal(command, "list");
  assert.deepEqual(positional, []);
  assert.deepEqual(flags, {});
});

test("parseArgs: positional argument before flags", () => {
  const { command, positional, flags } = parseArgs(["show", "ssl-cert-expiry-check", "--json"]);
  assert.equal(command, "show");
  assert.deepEqual(positional, ["ssl-cert-expiry-check"]);
  assert.equal(flags.json, true);
});

test("parseArgs: boolean flag (--json) has no consumed value", () => {
  const { flags } = parseArgs(["list", "--json"]);
  assert.equal(flags.json, true);
});

test("parseArgs: value flag takes the next token as its value", () => {
  const { flags } = parseArgs(["list", "--category", "devops"]);
  assert.equal(flags.category, "devops");
});

test("parseArgs: two adjacent boolean flags don't swallow each other's value", () => {
  const { flags } = parseArgs(["deploy", "--list-installed", "--json"]);
  assert.equal(flags["list-installed"], true);
  assert.equal(flags.json, true);
});

test("parseArgs: --target and --mode are parsed as independent value flags", () => {
  const { positional, flags } = parseArgs(["deploy", "cost-alert", "--target", "github-actions", "--mode", "prompt"]);
  assert.deepEqual(positional, ["cost-alert"]);
  assert.equal(flags.target, "github-actions");
  assert.equal(flags.mode, "prompt");
});

test("parseArgs: --var can repeat and accumulates into flags.var", () => {
  const { flags } = parseArgs(["deploy", "ssl-cert-expiry-check", "--var", "host=example.org", "--var", "port=8443"]);
  assert.deepEqual(flags.var, { host: "example.org", port: "8443" });
});

test("parseArgs: --var with a malformed pair (no '=') is ignored", () => {
  const { flags } = parseArgs(["deploy", "id", "--var", "noequalsign"]);
  assert.equal(flags.var, undefined);
});

test("parseArgs: no --var flags means flags.var is absent", () => {
  const { flags } = parseArgs(["deploy", "id"]);
  assert.equal("var" in flags, false);
});

test("parseArgs: multiple positional args are all collected in order", () => {
  const { positional } = parseArgs(["recommend", "warn me before my SSL cert expires"]);
  assert.deepEqual(positional, ["warn me before my SSL cert expires"]);
});

test("parseArgs: unknown command still parses — dispatch decides what to do with it", () => {
  const { command, positional, flags } = parseArgs(["frobnicate", "foo", "--bar"]);
  assert.equal(command, "frobnicate");
  assert.deepEqual(positional, ["foo"]);
  assert.equal(flags.bar, true);
  assert.equal(command in COMMANDS, false);
});

test("parseArgs: empty argv has undefined command and no positional/flags", () => {
  const { command, positional, flags } = parseArgs([]);
  assert.equal(command, undefined);
  assert.deepEqual(positional, []);
  assert.deepEqual(flags, {});
});

test("COMMANDS dispatch table has an entry for every documented command", () => {
  for (const name of ["list", "categories", "init", "show", "next", "add", "recommend", "deploy", "uninstall", "update", "mcp"]) {
    assert.equal(typeof COMMANDS[name], "function", `missing dispatch entry for "${name}"`);
  }
});
