# MahaRudra Agentic AI Infra Docs

This docs tree separates public product documentation from internal implementation records.

## Public Docs

Public docs are written for GitHub, package users, and project maintainers. They describe the framework professionally in terms of package status, available capabilities, architecture, configuration, usage, security model, and troubleshooting.

Recommended reading order:

| Step | Folder | Purpose |
| --- | --- | --- |
| 1 | `00-start-here/` | Product orientation and current framework scope. |
| 2 | `02-architecture/` | Package boundaries, runtime surfaces, and system decisions. |
| 3 | `03-cli/` | Generator commands and generated project contract. |
| 4 | `04-core-framework/` | Core contracts, profiles, runtime concepts, and token efficiency. |
| 5 | `05-security/` | Local and remote-safe security rules. |
| 6 | `06-runbooks/` | Operational setup and troubleshooting workflows. |
| 7 | `07-dashboard/` | Observability, dashboard data flow, and token usage views. |
| 8 | `08-examples/` | Example setup paths for generated infrastructure. |

## Internal Docs

Internal docs live under `internal/` and may include implementation history, learning notes, working decisions, and engineering journal entries.

Keep public docs product-facing. Keep implementation chronology and planning notes internal.

## Documentation Diagram Selection Standard

Do not use Mermaid, PlantUML, Graphviz, image diagrams, or extension-dependent diagram formats. Use plain Markdown-compatible diagrams that visually resemble Mermaid-style diagrams where practical, including ASCII/Unicode boxes, arrows, sequence-style text diagrams, class/interface relationship diagrams, tree diagrams, decision trees, workflow blocks, and Markdown tables.

Pick the diagram form by the reader question instead of repeating the same visual pattern:

| Reader question | Use this form | Good fit |
| --- | --- | --- |
| What are the major systems and boundaries? | ASCII/Unicode box architecture diagram | Product architecture, local vs remote surfaces, dashboard package boundary |
| What happens first, next, and last? | Sequence-style text diagram or call-flow diagram | CLI init, runtime startup, dashboard snapshot rendering |
| What branches by trust, policy, or mode? | Branching flow or decision tree | Local vs remote runtime, dashboard bind policy, write approval policy |
| What lives where? | Tree diagram | Generated project folders, package source folders, template layout |
| Who owns what? | Markdown breakdown table | Package responsibilities, metric ownership, safe vs unsafe outputs |
| How do options compare? | Markdown comparison matrix | Profiles, retrieval strategies, runtime surfaces |
| When does work happen? | Timeline table | Release gates, staged rollout, migration plan |
| Which classes or interfaces depend on each other? | Class/interface relationship diagram | Provider contracts, harness dependencies, renderer dependencies |

Diagrams must render correctly as plain text, GitHub Markdown, and VS Code raw Markdown. Use `txt` fences for complex diagrams and add short surrounding explanations so the diagram clarifies the implemented framework rather than decorating the page. Public docs must stay professional and product-facing, while time-based implementation notes and internal planning diagrams stay under `docs/internal/`.
