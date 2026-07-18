# Trajectory Module

The trajectory module records safe runtime steps.

## Classes

- `InMemoryTrajectoryRecorder`: stores safe trajectory events for tests and dashboard providers.

## Flow

```txt
┌─────────────────────┐
│ Harness Or Executor │
└──────────┬──────────┘
           ▼
┌───────────────────────┐
│ Safe Trajectory Event │
└──────────┬────────────┘
           ▼
┌───────────────────────┐
│ In-Memory Recorder    │
└──────────┬────────────┘
           ▼
┌───────────────────────┐
│ Summary               │
└───────────────────────┘
```

Records do not include raw task text, approval text, chunks, vectors, SQL, stack traces, or command output.
