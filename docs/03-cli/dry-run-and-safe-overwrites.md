# Dry-Run And Safe Overwrites

The generator builds a write plan before writing files.

```txt
render templates
  -> validate relative paths
  -> block sensitive targets
  -> compare existing files
  -> create, append, unchanged, conflict, overwrite, or blocked
```

## Dry-Run

```powershell
create-agentic-ai-infra init --dry-run
```

Dry-run prints what would happen and writes nothing.

## Conflicts

Existing files are not overwritten by default. Conflicting files are reported so users can review the generated content.

## Force

`--force` can overwrite non-sensitive conflicting generated files. It never applies to secrets, dependency folders, build output, `.git`, `.env*`, `.npmrc`, keys, or paths outside the target root.

## Managed `.gitignore`

`.gitignore` is append-only. The generator adds one managed block for `.agentic-local/` and related local cache/report paths, preserves existing user content, and leaves the block unchanged on rerun.
