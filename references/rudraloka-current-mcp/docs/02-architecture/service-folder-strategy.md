# Service Folder Strategy

## Selected Direction

Future backend services will be separated into:

```txt
services/
├── ai/
├── non-ai/
└── platform/
```

The user selected this separation as the future direction. Folder expansion will happen later when services are ready to be created.

## Why Separate AI And Non-AI Services

AI services often have different needs:

- Model calls.
- Retrieval.
- Embedding pipelines.
- Eval harnesses.
- AI observability.
- Safety and grounding rules.

Non-AI business services usually focus on transactional correctness:

- Orders.
- Catalog.
- Inventory.
- Payments.
- Accounts.

Platform services support shared infrastructure:

- Auth.
- Notifications.
- Internal gateways.
- Observability.
- Developer tooling.

Separating these folders keeps ownership and mental models clearer.

## Future Examples

Possible AI services:

- `services/ai/recommendations`
- `services/ai/rag-search`
- `services/ai/evals`

Possible non-AI services:

- `services/non-ai/catalog`
- `services/non-ai/orders`
- `services/non-ai/inventory`

Possible platform services:

- `services/platform/auth`
- `services/platform/notifications`
- `services/platform/api-gateway`

## Tradeoffs

A flat `services/` folder is simpler at first, but can become noisy when AI, business, and platform services grow.

Splitting by category adds a little structure early, but makes future ownership clearer.

Splitting by deployment environment is usually less helpful because one service may move across local, staging, and production while keeping the same code identity.

