# Security Policy

## Supported Versions

crondex is a single-track package — only the latest published version on
npm receives fixes. There are no maintained release branches.

| Version | Supported |
| --- | --- |
| latest | ✅ |
| older | ❌ |

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, use [GitHub Security Advisories](https://github.com/wonsukchoi/crondex/security/advisories/new)
to report privately. Include:

- A description of the vulnerability and its impact
- Steps to reproduce (a specific job id, CLI command, or MCP tool call, if
  applicable)
- Any suggested fix, if you have one

You should get an initial response within 5 business days. If the report
is confirmed, a fix will be released on npm and credited in
[CHANGELOG.md](CHANGELOG.md) (unless you prefer to stay anonymous).

## Scope

crondex is a catalog of cron job definitions (shell commands + metadata)
plus a CLI/MCP server that deploys them to various schedulers. Relevant
report categories:

- A catalog job whose default command is unsafe (destructive without
  `--dry-run`/confirmation, exfiltrates data, invokes a nonexistent or
  malicious binary)
- Command/argument injection in the CLI, MCP server, or any `deploy`
  target's codegen (e.g. unescaped job fields reaching a generated
  crontab line, GitHub Actions YAML, systemd unit, or shell script)
- Path traversal or arbitrary file write in `add`, `init`, `deploy`, or
  `uninstall`

Out of scope: vulnerabilities in third-party CLI tools a job's command
happens to invoke (e.g. `curl`, `aws`) — report those upstream.
