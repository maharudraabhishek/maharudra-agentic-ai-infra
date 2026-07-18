# Examples

Examples show generated setup patterns without claiming package publishing, production deployment, complete production auth, automatic Docker, or automatic migrations.

| Example | Profile/runtime | Demonstrates |
| --- | --- | --- |
| `examples/demo-blank-workspace/` | `secure-readonly`, local STDIO MCP | Safe generated setup for an empty folder. |
| `examples/demo-existing-fullstack-app/` | `local-context` | Adding local context infrastructure without changing app code. |
| `examples/demo-full-agentic-context/` | `full-agentic-context`, token-efficient multi-agent | Retrieval choices, dashboard, user-started Docker files. |
| `examples/demo-remote-safe/` | `remote-safe`, remote MCP/API | Remote-safe service skeleton and policy boundaries. |

```txt
choose example
  -> run init with --dry-run
  -> review write plan
  -> run init in a temp or project folder
  -> run validate
  -> run doctor
  -> complete manual setup such as Docker or project auth policy
```
