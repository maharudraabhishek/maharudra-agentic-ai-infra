# 2026-05-09 Secure MCP Tools And Evals

## Controlled-Write Workflow

Direct file writing is risky because an AI client could overwrite user work, write to the wrong path, or apply a change without review.

Rudraloka uses a controlled-write workflow:

1. Propose the change.
2. Show the proposed content.
3. Require exact approval text.
4. Revalidate the target before writing.

## Patch Tools

`propose_file_patch` creates an exact-replacement patch proposal. It does not modify the file.

`apply_approved_patch` applies the patch only when approval text exactly matches:

```txt
APPLY_PATCH:<patchId>
```

Exact replacement matters because it avoids ambiguous edits. If the original text appears more than once, the patch is denied.

## New-File Tools

`propose_new_file` creates a proposal for a new file.

`apply_approved_new_file` creates the file only with exact approval text:

```txt
APPLY_NEW_FILE:<proposalId>
```

It refuses to overwrite existing files. That protects unrelated user work.

## Allowlisted Commands

The command tool is not a shell. It only runs allowlisted pnpm scripts for allowlisted packages.

This is safer than accepting arbitrary command strings because the server builds process arguments itself after validation.

## Audit Logs

Audit logs record security-relevant events, such as attempted writes, approved writes, and command checks.

They should contain metadata, not payloads. That means no patch bodies, file contents, command output, approval text, or secrets.

## traceId And spanId

A `traceId` connects events from one tool call.

A `spanId` identifies one specific operation inside that trace.

Together they make logs easier to correlate without logging sensitive content.

## Eval Harness

The eval harness is a security drill for the MCP server.

It asks: "Do the important denials still work?"

Examples:

- Reading `.env` should be denied.
- Reading `../../.env` should be denied.
- Listing `node_modules` should be denied.
- Running an unknown package script should be denied.
- Applying a patch with wrong approval text should be denied.

Expected denials count as passes because the safe behavior is to fail closed.

Run evals after MCP refactors so security behavior is tested, not just assumed.

