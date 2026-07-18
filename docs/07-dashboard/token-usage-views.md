# Token Usage Views

Token views show aggregate counts and efficiency signals.

## Panels

- total tokens versus hard budget
- tokens by tool
- tokens by agent role
- shared-context token estimate
- estimated savings versus naive multi-agent context duplication

The view uses safe token records only. Raw prompts, raw task text, approval text, and chunks are not rendered.

| Panel | Source |
| --- | --- |
| Total tokens vs hard budget | Safe token records. |
| Tokens by tool | Aggregated tool labels and counts. |
| Tokens by agent role | Aggregated role labels and counts. |
| Shared-context estimate | Bounded shared-context metadata. |
| Estimated savings | Derived comparison against naive duplicated context. |
