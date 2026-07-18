# 2026-05-08 Local MCP Foundation

## What MCP Is

MCP is a protocol that lets an AI client use tools exposed by a server.

In Rudraloka, Codex is the AI coding client. `rudraloka-dev-mcp` is the controlled local tool backend. The server decides what Codex is allowed to read, list, write, or run.

## Mental Model

Think of the MCP server as a secure tool bridge.

Codex can ask to cross the bridge, but the bridge has gates:

- Is the path inside the project?
- Is the file type allowed?
- Is this a secret?
- Is this directory blocked?
- Is this command allowlisted?

The important part is that the checks happen inside the server, not only in a prompt.

## STDIO Transport

STDIO means the MCP client starts the server as a local child process and talks to it through standard input and output.

For local development, this is safer than opening a network port. There is no public HTTP endpoint, and the tool stays tied to the local development session.

## Why Local MCP Should Stay Local

The local MCP server can inspect the repository and run controlled development checks. That power belongs on the developer machine only.

A future ChatGPT-safe MCP server should be a separate HTTPS service with authentication, business-safe tools, and no local filesystem or shell access.

## Initial Tools

`project_info` returns safe metadata about the project root and security policy.

`safe_list_files` lists immediate children of safe directories.

`safe_read_file` reads small allowlisted text files.

These tools were the foundation because reading safely is the first step before writing safely.

## Why Some Paths Are Blocked

`.env` is blocked because it usually contains secrets like API keys and database URLs.

`node_modules` is blocked because it is large, generated, and not useful to put into AI context.

`.git` is blocked because it contains repository internals and can expose too much implementation detail.

## Path Traversal

Path traversal is when an input tries to escape the allowed folder.

Example:

```txt
../../.env
```

That path means "go up two directories, then read `.env`." The MCP server resolves paths before reading and denies anything outside the project root.

## Why pnpm Is Used

Rudraloka uses pnpm as the package manager. Keeping one package manager reduces lockfile confusion, install drift, and command ambiguity.

Use pnpm only in project docs and runbooks.

