# Local Knowledge Scanner And Chunking

## Concept

Milestone 2 builds the first safe reading layer for Rudraloka's future local RAG system.

It answers three questions:

1. Which files are allowed to become project knowledge?
2. Which allowed files are present right now?
3. How can those files be split into useful pieces without losing meaning?

This is not embeddings yet. It is not vector search yet. It is the careful preparation step before those features exist.

## Mental Model

Think of the knowledge pipeline like preparing books for a library.

The indexing policy is the front desk. It decides which books are allowed into the library.

The scanner is the inventory clerk. It records title, size, category, and fingerprints, but it does not photocopy the whole book into the inventory sheet.

The chunker is the person placing bookmarks. It breaks a large book into useful sections so a future search system can find the right part quickly.

```txt
front desk
   |
   v
allowed books only
   |
   v
inventory sheet
   |
   v
bookmarked sections
```

This diagram shows why policy comes before chunking. The system must decide what is safe before it decides how to split it.

## Why It Matters

RAG can become dangerous if it indexes everything.

A naive indexer might copy `.env` files, package caches, old archive docs, generated output, or internal MCP logs into a searchable store. That would create a hidden second copy of sensitive data.

Rudraloka avoids that by making the first question a security question:

```txt
Should AI ever see this file?
```

Only after that answer is yes does the scanner read approved text for hashes and preview chunks.

## Indexing Policy

The indexing policy is the allowlist.

Allowed sources:

- `AGENTS.md`
- `CLAUDE.md`
- `.agents/skills/**/SKILL.md`
- `docs/**/*.md`, except `docs/99-archive/` by default
- `mcp/rudraloka-dev-mcp/src/**/*.ts`

Blocked sources:

- `.env` and `.env.*`
- `.npmrc`
- private keys
- credentials and tokens
- `.git`
- `node_modules`
- `dist`
- `build`
- `coverage`
- `.mcp-local`
- unsupported extensions
- files above the configured size limit

The policy fails closed. If the path is uncertain, too large, archived by default, or outside the approved roots, it is skipped.

## Scanner

The scanner walks only approved roots. It does not crawl the whole repository.

For each allowed file, it records:

- path
- source type
- file hash
- content hash
- size
- archive flag

For skipped paths, it records a safe skip reason.

It does not return full file contents in the scan report.

```txt
approved roots
   |
   v
path policy
   |
   v
read allowed file
   |
   v
hashes + metadata only
```

This diagram shows the scanner boundary. File text is read only after policy checks pass, and the report contains metadata instead of a raw content dump.

## Chunking

Chunking means splitting a file into smaller pieces that still make sense.

Bad chunking cuts through ideas randomly. Good chunking keeps structure.

```txt
large file
   |
   v
meaningful sections
   |
   v
future searchable chunks
```

This diagram shows the goal. A future retrieval system should find the smallest useful section, not dump the whole file.

## Markdown Heading Chunking

Markdown files already have structure through headings.

Example:

```txt
# MCP Security Policy
## Blocked Files
## Blocked Directories
```

The heading-aware chunker keeps `headingPath` metadata such as:

```txt
MCP Security Policy > Blocked Files
```

That matters because a future answer can cite not only the file, but the specific section of the file.

## TypeScript AST Chunking

TypeScript source has structure through functions, classes, interfaces, types, and exported declarations.

The TypeScript chunker uses the TypeScript compiler API to parse source text into an AST.

Important safety detail: it parses text only. It does not import or execute the project file.

```txt
TypeScript text
   |
   v
compiler parser
   |
   v
top-level symbols
   |
   v
symbol-aware chunks
```

This diagram shows the AST path. The parser helps find code structure without running code.

## Fallback Chunking

Not every file has useful headings or symbols. Parser errors can also happen.

Fallback chunking splits text into medium windows with light overlap.

Overlap helps avoid losing context at boundaries:

```txt
chunk 1: [----------]
chunk 2:        [----------]
```

The repeated part is the overlap. Too little overlap can lose meaning. Too much overlap creates duplicate noisy chunks.

## Why This Is Not Yet Embeddings Or RAG

Milestone 2 stops before the expensive and persistent parts.

It does not:

- create embeddings
- write chunks into Postgres
- write vectors into pgvector
- create HNSW indexes
- run vector search
- run full-text search
- build task context
- retrieve answers
- rerank with a model

```txt
Milestone 2 now
   |
   v
policy -> scanner -> chunk previews

Future milestones
   |
   v
embeddings -> storage -> search -> retrieval -> context planner
```

This diagram separates preparation from real retrieval. The current work is about proving safe inputs and chunk shape.

## Rudraloka Example

If Codex needs to understand MCP security, a future retrieval system should prefer current docs such as:

- `AGENTS.md`
- `docs/05-security/mcp-security-policy.md`
- `mcp/rudraloka-dev-mcp/src/security/path-policy.ts`

It should not retrieve:

- `.env`
- `.mcp-local` logs
- `node_modules`
- archived docs unless explicitly requested later

Milestone 2 lets us preview that policy before building the real index.

## Tradeoffs

Heading-aware Markdown chunks are more meaningful than fixed windows, but they need fallback logic for huge sections.

AST-based TypeScript chunks are better for code symbols than regex, but they depend on the TypeScript compiler API and must fall back safely on parse problems.

Fallback chunks are reliable and simple, but they do not understand document meaning.

Excluding archives by default keeps current context cleaner, but historical questions may need an explicit archive mode later.

## Common Mistakes

- Indexing everything because it is convenient.
- Returning full file contents in scan reports.
- Treating `.env` as just another text file.
- Entering `node_modules`, `.git`, `dist`, `build`, `coverage`, or `.mcp-local`.
- Creating random chunk IDs that change on every run.
- Splitting Markdown without preserving heading paths.
- Importing TypeScript files to inspect them instead of parsing text.
- Calling this RAG before embeddings, storage, and retrieval exist.

## How It Connects To The Current Architecture

The local MCP server remains a local developer tool over STDIO.

The new knowledge tools reuse the same security posture:

- narrow tools
- explicit schemas
- path policy
- blocked secrets
- bounded outputs
- no public exposure
- no source mutation

The future RAG stack will build on this layer.

```txt
rudraloka-dev-mcp
   |
   |-- existing safe reads and writes
   |-- local AI DB foundation
   `-- knowledge scanner/chunker previews
           |
           v
        future embeddings and retrieval
```

This diagram shows the new layer as part of the local MCP system, not as a production AI service.

## Related Docs

- [Local MCP Agentic Context Engineering + RAG Design Spec](../04-ai-infra/local-mcp-agentic-context-rag-design-spec.md)
- [Local MCP AI Infra Plan](../04-ai-infra/local-mcp-ai-infra-plan.md)
- [Local MCP Context Tools](../03-mcp/local-mcp-context-tools.md)
- [MCP Security Policy](../05-security/mcp-security-policy.md)
- [Local Knowledge Scanner And Chunking Runbook](../06-runbooks/local-knowledge-scanner-and-chunking.md)
