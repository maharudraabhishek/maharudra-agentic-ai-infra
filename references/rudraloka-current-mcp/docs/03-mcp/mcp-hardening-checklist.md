# MCP Hardening Checklist

## What MCP Hardening Means

MCP hardening means checking that the local tool server stays safe before it receives more capabilities.

The Rudraloka MCP server can read project files, propose writes, run selected pnpm scripts, and report logs. Those powers are useful only if the server keeps strong boundaries around secrets, generated files, command execution, writes, and observability.

## Mental Model

Think of hardening as a safety inspection before adding more AI tools.

Before a workshop adds a bigger machine, it checks the guards, emergency stops, access rules, and maintenance logs. Before Rudraloka adds project indexing, RAG, or more automation, the local MCP server should prove that its current safety controls still work.

## Current Hardening Controls

### Deny-by-default file access

The read surface is intentionally narrow. The server only allows approved text extensions and blocks unknown extensions until they are reviewed.

### Secret blocking

Secret-shaped files such as `.env`, `.env.*`, `.npmrc`, SSH keys, private keys, tokens, and credentials must be denied before file content is read.

### Blocked directories

Directories such as `.git`, `.mcp-local`, `node_modules`, `dist`, `build`, and `coverage` are blocked from ordinary read and list tools.

`.mcp-local` is especially sensitive because it stores internal proposal and log state. It should only be exposed through bounded summary tools.

### Allowlisted scripts

The MCP server is not a shell. Command execution is limited to known pnpm scripts for known packages.

For now, `lint` and `test` are safe foundation scripts:

- `lint` reuses TypeScript checking.
- `test` runs the package typecheck.

Real ESLint rules and unit tests are future hardening work, not part of this step.

### Controlled-write approval workflow

Writes use a propose/apply pattern instead of direct blind writes.

Patch proposals require exact replacement text. Apply operations require exact approval text. New-file proposals refuse to overwrite existing files.

### Logs and audit records

App logs record operational metadata. Audit logs record security-relevant decisions.

Logs must not contain file contents, patch bodies, approval text, command output, or secrets.

### Trace IDs and span IDs

`traceId` links related operations from one tool call. `spanId` identifies a specific operation inside that trace.

These fields make debugging easier without exposing sensitive data.

### Security eval harness

`run_mcp_security_evals` runs repeatable checks for expected denials such as secret-file blocking, path traversal blocking, command allowlist blocking, approval enforcement, overwrite protection, and log summary safety.

Expected denial counts as a pass because the server is proving that it fails closed.

### Log rotation and log size protection

Before appending to local JSONL logs, the server checks file size. If a log is larger than the configured threshold, it rotates one backup:

- `app.jsonl` becomes `app.1.jsonl`
- `audit.jsonl` becomes `audit.1.jsonl`

This keeps local logs useful without letting them grow forever. Logs still stay under `.mcp-local/`, which remains blocked from ordinary project reads.

## When To Run Hardening Checks

Run hardening checks:

- After MCP refactors.
- Before adding new MCP tools.
- Before enabling broader file access.
- Before adding local RAG or project indexing.
- After changing path, secret, command, write, log, or audit policy.

## Future Hardening Work

Future improvements should include:

- Real ESLint configuration.
- Real unit tests for policy logic.
- More eval coverage for edge cases.
- Policy config files when the allowlists become too large for source constants.
- Local RAG indexing after security boundaries are stable.
- OpenTelemetry later, once local observability needs exceed JSONL summaries.

## Related Docs

- [Local MCP Architecture](local-mcp-architecture.md)
- [Controlled Write Workflow](controlled-write-workflow.md)
- [MCP Observability](mcp-observability.md)
- [MCP Security Eval Harness](mcp-security-eval-harness.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
