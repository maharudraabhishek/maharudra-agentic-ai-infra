# Internal runtime value safety

This folder contains package-private trust-boundary helpers. It is not exported
from the runtime package barrel.

`safe-runtime-values.ts` owns the canonical runtime membership checks for error
codes, guard actions, feedback actions, refusal reasons, and safe opaque trace
identifiers.

```txt
untrusted injected value
          │
          ▼
safe-runtime-values.ts
          │
          ├── canonical member → preserve typed value
          └── unknown/sensitive → reject or use stable fallback
```

Keeping these guards together prevents executors and orchestration from
silently developing different persistence and reporting rules.
