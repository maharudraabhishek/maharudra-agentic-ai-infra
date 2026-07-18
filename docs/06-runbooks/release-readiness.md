# Release Readiness

Release readiness means packages are prepared for review, not published.

## Current Posture

- Packages remain `private:true`.
- Root license remains `UNLICENSED`.
- Publishing is prepared but not executed.
- The release workflow is manual and non-publishing.

## Manual Workflow

```txt
run full checks
  -> inspect package metadata
  -> inspect package dry-run output
  -> confirm docs and examples are truthful
  -> decide license/repository/publish approval separately
```

## Required Later For Publishing

| Requirement | Status |
| --- | --- |
| License decision | Manual approval required. |
| Repository metadata | Manual approval required. |
| Registry credentials | Manual setup required. |
| Remove `private:true` | Manual approval required. |
| Publish command | Not present in release workflow. |

The release workflow must not publish packages, even when credentials are available.
