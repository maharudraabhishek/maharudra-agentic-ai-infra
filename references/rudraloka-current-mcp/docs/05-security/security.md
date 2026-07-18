# Security Overview

Security in Rudraloka has two layers:

- General project safety for AI-assisted development.
- MCP-specific policy for local tools.

The broad rule is least privilege. Tools should expose only the access needed for the current workflow.

## Core Principles

- Do not read secrets.
- Do not expose local filesystem tools to public ChatGPT web connectors.
- Keep local dev MCP local.
- Use allowlists for commands and writable paths.
- Use deny-by-default for unknown file types and sensitive paths.
- Keep logs useful but free of payloads and secrets.
- Require user confirmation for payments, orders, checkout, or irreversible business actions.

For MCP-specific policy, read [mcp-security-policy.md](mcp-security-policy.md).

