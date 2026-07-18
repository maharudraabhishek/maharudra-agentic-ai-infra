# @maharudra/create-agentic-ai-infra

Generator CLI package for creating MahaRudra Agentic AI Infra project scaffolds.

The package remains private until publishing is explicitly approved. It is package-ready for local workspace use and release-readiness checks.

## Module Map

| Module | Responsibility |
| --- | --- |
| `src/args.ts` | Parse CLI flags into typed options. |
| `src/commands.ts` | Coordinate `init`, `validate`, and `doctor`. |
| `src/validation.ts` | Normalize and validate user input. |
| `src/config-factory.ts` | Build generated `agentic-ai-infra.config.ts`. |
| `src/templates.ts` | Select and render generated files. |
| `src/planner.ts` | Build the write plan, block unsafe paths, and append `.gitignore` safely. |
| `src/writer.ts` | Execute eligible create, append, and overwrite actions. |
| `src/doctor.ts` | Run non-mutating local readiness checks. |

## Execution Flow

```txt
CLI args
  -> parseCliArgs
  -> normalizeInitOptions
  -> validateGeneratedConfig
  -> renderTemplates
  -> createWritePlan
  -> executeWritePlan or dry-run output
```

The generator does not start Docker, run migrations, mutate global tool config, write secret files, or expose local STDIO MCP through remote surfaces.

## Verification

Generated-project smoke tests create temporary projects, validate neutral paths, check selected-only files, smoke-compile skeleton TypeScript, and clean up successful temp folders.
