# @maharudra/agentic-ai-infra-test-utils

Shared test utility package for MahaRudra Agentic AI Infra packages and generated projects.

The package owns reusable scaffold assertions and safe generated-project scanners. It does not read secret-looking files and does not mutate generated projects.

## Module Map

| Export | Responsibility |
| --- | --- |
| `REQUIRED_GENERATED_PROJECT_PATHS` | Stable required paths for generated project smoke tests. |
| `normalizeProjectPath` | Cross-platform path normalization for assertions. |
| `collectGeneratedProjectFiles` | Recursive safe file listing that skips private/build/dependency folders. |
| `scanGeneratedProject` | Unresolved template marker, forbidden filename, and forbidden wording scan. |
| `missingRequiredGeneratedPaths` | Required-path gap report. |

## Flow

```txt
generated temp project
  -> collect safe file list
  -> record forbidden filenames without reading them
  -> scan readable generated files for unresolved template markers
  -> return bounded assertion report
```

Test utilities help package tests share verification behavior without coupling production code to private test fixtures.
