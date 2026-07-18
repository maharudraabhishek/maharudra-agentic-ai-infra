# Create Package Tests

This folder verifies generator behavior from the package boundary rather than from individual implementation details.

## Test Areas

- Argument parsing and command routing.
- Config generation and validation.
- Template rendering and unresolved token checks.
- Safe write-plan behavior, including dry-run and idempotency.
- Doctor behavior that checks prerequisites without mutating files.
- Public documentation wording checks.

## Test Flow

```txt
┌──────────────────────┐
│ Test Fixture Options │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ CLI Command Or Helper│
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Rendered Files Or    │
│ Write Plan           │
└──────────┬───────────┘
           ▼
┌──────────────────────────────────────┐
│ Assertions For Safety And Structure │
└──────────────────────────────────────┘
```

Tests should keep generated files bounded and should not start Docker, run migrations, or use old project-specific eval suites.
