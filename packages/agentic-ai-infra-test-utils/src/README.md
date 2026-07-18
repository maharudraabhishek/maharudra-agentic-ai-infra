# Test Utility Source

This source folder exposes generated-project smoke-test helpers.

```txt
index.ts
  -> path normalization
  -> safe generated file collection
  -> unresolved template marker and wording scan
  -> required-path gap detection
```

The helpers are read-only and skip secret-looking files, dependency folders, build outputs, VCS state, and private `.agentic-local/` state.
