# Local MCP Hardening

## Concept

MCP hardening means making the local MCP server safer before giving it more power.

In Rudraloka, the local MCP server is a controlled bridge between Codex and the workspace. It can expose project metadata, list safe files, read safe text files, propose controlled writes, run allowlisted pnpm scripts, and summarize logs. Hardening checks that each of those powers has a clear boundary.

Hardening is not the same as adding features. It is the discipline of asking, "If an AI client, prompt-injected document, or mistaken workflow asks for something unsafe, does the server deny it?"

## Mental Model

Think of the local MCP server like a workshop door with labeled keys.

Codex can ask to use a key, but the MCP server decides whether that key exists, which room it opens, and whether the request is allowed. Hardening is the routine inspection that checks the locks, labels, visitor log, and emergency rules before the workshop adds more powerful equipment.

## Why It Matters

AI coding tools are useful because they can move quickly through a project. That speed also means mistakes can spread quickly if the tool layer is too permissive.

Hardening matters because it:

- Keeps secrets out of AI context.
- Prevents accidental reads outside the project root.
- Blocks generated or oversized folders from flooding context.
- Prevents arbitrary command execution.
- Keeps writes reviewable through proposal and approval steps.
- Makes security behavior repeatable through evals.
- Keeps logs useful without turning them into another sensitive data store.

For Rudraloka, this is especially important because local MCP is the foundation for later AI infrastructure. Project indexing, RAG, tool orchestration, and eval automation should be added only after the local tool bridge has predictable safety behavior.

## Rudraloka Example

The current local MCP hardening essentials include:

- `.env`, `.env.*`, `.npmrc`, SSH keys, private keys, and credentials are blocked.
- `.git`, `.mcp-local`, `node_modules`, `dist`, `build`, and `coverage` are blocked from ordinary reads and listings.
- Unknown file extensions are denied by default.
- Commands are limited to allowlisted pnpm scripts.
- Writes use `propose_file_patch` / `apply_approved_patch` or `propose_new_file` / `apply_approved_new_file`.
- `run_mcp_security_evals` checks that expected denials still happen.
- App and audit logs use JSONL files under `.mcp-local/` and are summarized through safe metadata-only tools.
- Log rotation keeps `app.jsonl` and `audit.jsonl` from growing forever.

A simple example is secret-file blocking. If an AI prompt asks Codex to read `.env`, the server should deny the path before reading any bytes. The denial is the success case.

Another example is log summary sanitization. Raw local logs are like CCTV footage: useful for internal investigation, but too detailed to hand to every visitor. `audit_read_summary` and `log_read_summary` should behave like redacted incident reports. They can show safe metadata such as timestamps, trace IDs, tool names, status, file paths, package names, proposal IDs, hashes, and bounded messages, but they must not show raw file contents, patch bodies, `originalText`, `replacementText`, command output, or raw `content` fields.

This output filter matters even for old log records. If an earlier logger wrote a risky key name into `.mcp-local`, the summary tool should still strip it before returning data to an AI client. Hardening is not only about writing safer records tomorrow; it is also about safely reading yesterday's records.

The word `content` has two meanings in this area. MCP protocol responses naturally have a wrapper named `content`, which contains the text returned by a tool. That wrapper is normal. Unsafe file `content` means raw user/project data, proposal bodies, or new-file bodies inside summary event payloads. Security evals should check the event payloads, not confuse the protocol wrapper with leaked file content.

## Tradeoffs

Strong hardening creates helpful friction.

The upside is safety: fewer accidental secret leaks, fewer destructive commands, less context flooding, and clearer audit trails.

The downside is that some legitimate work may require a new allowlist entry or a new controlled tool. That can feel slower than direct filesystem or shell access. In a production-grade learning project, that friction is valuable because it forces security decisions to be explicit.

Another tradeoff is simplicity versus completeness. The current log rotation keeps only one backup and avoids external dependencies. That is enough for local development now. A future production system may need retention policies, compression, centralized observability, and OpenTelemetry.

## Common Mistakes

- Treating MCP as a general shell instead of a least-privilege tool server.
- Assuming model instructions alone can protect secrets.
- Allowing broad file reads before defining blocked directories and extensions.
- Logging command output, patch bodies, file contents, or approval text.
- Forgetting that STDIO MCP must not write operational logs to stdout.
- Adding RAG indexing before deciding what must never be indexed.
- Treating expected-denial evals as failures when they are actually proof that the server fails closed.
- Expanding allowlists without updating docs and eval coverage.

## Related Docs

- [MCP Hardening Checklist](../03-mcp/mcp-hardening-checklist.md)
- [Local MCP Architecture](../03-mcp/local-mcp-architecture.md)
- [MCP Observability](../03-mcp/mcp-observability.md)
- [MCP Security Eval Harness](../03-mcp/mcp-security-eval-harness.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
- [AI Infra Roadmap](../04-ai-infra/ai-infra-roadmap.md)
