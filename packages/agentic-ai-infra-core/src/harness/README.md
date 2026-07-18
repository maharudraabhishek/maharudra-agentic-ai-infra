# Harness Contracts Module

The harness module defines shared contracts for tool execution and package tests.

## Main Types

- `ToolExecutionContext` describes the safe runtime context passed to a tool handler.
- `ToolExecutionResult` describes handler output before it is mapped to `FrameworkResult`.
- `ToolExecutionError` describes safe tool errors without raw stack traces or command output.
- `ToolExecutionHandler` defines concrete runtime tool behavior behind `ToolContract` metadata.
- `EvalHarnessContract` describes eval suite orchestration.

## Call Flow

```txt
┌──────────────┐
│ ToolContract │
└──────┬───────┘
       ▼
┌──────────────────────┐
│ ToolExecutionHandler │
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ ToolExecutionResult  │
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ Sanitizer            │
└──────┬───────────────┘
       ▼
┌──────────────────────┐
│ FrameworkResult      │
└──────────────────────┘
```

Harness types keep executable behavior separate from tool metadata and preserve one typed result contract.
