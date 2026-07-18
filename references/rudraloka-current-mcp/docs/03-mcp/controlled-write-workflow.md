# Controlled-Write Workflow

## Why Direct Writes Are Risky

A direct `write_file` tool is simple, but it gives an AI client a lot of power. If the model chooses the wrong file or overwrites user work, the damage happens immediately.

Rudraloka uses controlled writes so generated edits have a review point before they touch project files.

## Propose And Apply Pattern

The workflow has two steps:

1. Propose the change.
2. Apply the change only after exact approval.

This makes writes explicit and auditable.

## Exact Approval Text

Patch application requires:

```txt
APPLY_PATCH:<patchId>
```

New-file creation requires:

```txt
APPLY_NEW_FILE:<proposalId>
```

The text must match exactly. This makes the apply step deliberate and easy to review.

## Exact Replacement Patching

Patch proposals use exact text replacement.

That means the server checks that the original text appears exactly once. If it appears zero times, the file changed or the patch is stale. If it appears multiple times, the patch is ambiguous.

Both cases are denied.

## New-File Proposal Workflow

`propose_new_file` creates a proposal for an allowlisted path.

`apply_approved_new_file` creates the file only after exact approval.

The apply step uses overwrite protection. If the file appeared after proposal creation, the write fails instead of replacing user work.

## How Codex Should Use This Workflow

Codex should prefer MCP proposal tools for supported paths:

- Use safe reads to understand the current file.
- Propose the smallest useful change.
- Let the user review the proposal.
- Apply only with exact approval.
- Run relevant checks after changes.

When a path is not MCP-writable, Codex should still preserve the same spirit: small scoped changes, no secrets, no generated-output edits, and clear verification.

