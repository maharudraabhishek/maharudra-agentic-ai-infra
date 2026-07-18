# Token Efficiency Debugging

Use token reports to understand context size, role routing, and shared-context savings.

| Check | Why it matters |
| --- | --- |
| Confirm context is built once. | Prevents duplicated retrieval/context tokens. |
| Confirm routed roles are required. | Avoids paying for irrelevant role slices. |
| Compare role slices to shared context. | Verifies each role receives a narrower packet. |
| Check hard budget result. | Confirms overflow returns a typed failure. |
| Review safe dashboard panels. | Keeps token debugging visible without unsafe payloads. |

## Checks

- Confirm context is built once.
- Confirm only required roles are routed.
- Confirm role slices are smaller than shared context.
- Confirm hard budget failures return typed errors.
- Confirm dashboard token panels use safe summaries only.

If context is too large, reduce retrieval result count, tune role budgets, or prefer cited summaries over long evidence text.
