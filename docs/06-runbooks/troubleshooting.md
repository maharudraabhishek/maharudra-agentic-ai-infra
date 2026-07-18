# Troubleshooting

Use this runbook when generated setup, checks, or local commands do not behave as expected.

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| `pnpm.ps1` is blocked on Windows | PowerShell execution policy blocks script shims. | Use `pnpm.cmd` from PowerShell or adjust local execution policy intentionally. |
| Package not found on registry | Packages are private and publishing is prepared but not executed. | Use local workspace commands until publishing is approved. |
| Docker unavailable | Docker is not installed or not running. | Install/start Docker manually; the CLI never starts it. |
| Port conflict | Dashboard or database port is already in use. | Pick a new `--dashboard-port` or `--docker-port`. |
| Generated file conflict | Existing file differs from generated content. | Review the write plan; use `--force` only for non-sensitive generated files. |
| Invalid config | Profile/runtime/retrieval choices are incompatible. | Run `validate` and follow the typed error suggestions. |
| Remote runtime refuses startup | Missing auth, audit, or rate-limit policy. | Add project-owned policy references before remote startup. |
| Dashboard bind rejected | Non-loopback host lacks remote policy. | Keep loopback or provide auth, audit, and rate-limit policy. |
| Unresolved template marker in generated files | Template rendering defect. | Run generated-project smoke tests before release. |
| Accidental publish concern | Release workflow is manual and non-publishing. | Keep `private:true` until explicit publishing approval. |
