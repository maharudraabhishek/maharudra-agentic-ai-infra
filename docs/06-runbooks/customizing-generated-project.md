# Customizing A Generated Project

Generated projects include `CUSTOMIZE_WITH_CODEX.md` as a guided customization note.

## Workflow

```txt
┌───────────────────┐
│ Generated Project │
└─────────┬─────────┘
          ▼
┌────────────────────────┐
│ CUSTOMIZE_WITH_CODEX.md│
└─────────┬──────────────┘
          ▼
┌────────────────────────┐
│ User Fills Details     │
└─────────┬──────────────┘
          ▼
┌────────────────────────┐
│ Codex Proposes Updates │
└─────────┬──────────────┘
          ▼
┌────────────────────────┐
│ User Reviews Changes   │
└────────────────────────┘
```

Keep customization focused on project identity, paths, safety constraints, and docs. Do not expose secrets or global tool configuration.
