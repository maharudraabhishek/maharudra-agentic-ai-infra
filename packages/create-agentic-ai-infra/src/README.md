# Generator Source

The create package source is organized around one safe generation flow.

```txt
args.ts
  -> validation.ts
  -> config-factory.ts
  -> templates.ts
  -> planner.ts
  -> writer.ts
```

`commands.ts` connects the flow to `init`, `validate`, and `doctor`. `cli.ts` is only the executable wrapper.

## Safety Rules

- Build a write plan before writing files.
- Keep dry-run non-mutating.
- Preserve existing files unless safe force or append-only `.gitignore` handling applies.
- Block sensitive paths even when `--force` is used.
- Keep doctor read-only and non-starting.
