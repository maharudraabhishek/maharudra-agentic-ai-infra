import type { ObservabilityConfig } from "@maharudra/agentic-ai-infra-core";

// ---------------------------------------------------------------------------
// Runtime logging sinks (RuntimeObservabilitySink)
// ---------------------------------------------------------------------------

/** Log levels accepted by runtime observability sinks. */
export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

/** One bounded runtime log event. */
export type RuntimeLogEvent = {
  readonly level: RuntimeLogLevel;
  readonly message: string;
  readonly metadata?: Record<string, string | number | boolean | null>;
};

/** Interface for runtime-safe logging sinks. */
export interface RuntimeObservabilitySink {
  /** Records one safe runtime event. */
  log(event: RuntimeLogEvent): void | Promise<void>;
}

/**
 * Observability sink that writes human-readable runtime diagnostics to stderr.
 *
 * This is safe for STDIO MCP because stdout is reserved for protocol traffic.
 */
export class StderrObservabilitySink implements RuntimeObservabilitySink {
  /**
   * Writes one bounded log line to stderr with optional JSON metadata.
   */
  log(event: RuntimeLogEvent): void {
    const metadata = event.metadata ? ` ${JSON.stringify(event.metadata)}` : "";

    process.stderr.write(`[agentic-ai-infra:${event.level}] ${event.message}${metadata}\n`);
  }
}

/**
 * Test and embedding sink that records runtime events in memory.
 */
export class MemoryObservabilitySink implements RuntimeObservabilitySink {
  readonly events: RuntimeLogEvent[] = [];

  /**
   * Stores the event without writing to stdout/stderr.
   */
  log(event: RuntimeLogEvent): void {
    this.events.push(event);
  }
}

/**
 * No-op sink for generated skeletons and tests that need explicit silence.
 */
export const silentObservabilitySink: RuntimeObservabilitySink = {
  /**
   * Accepts events without side effects.
   */
  log() {
    // Intentionally empty for tests and generated skeletons that want no default logging.
  }
};

// ---------------------------------------------------------------------------
// Tracing sinks (ObservabilitySink)
// Separate from logging sinks. Implement the span-based OTel-compatible API.
// ---------------------------------------------------------------------------

/**
 * One active tracing span.
 *
 * Call `setAttribute` to attach context, then `end` when the operation finishes.
 * All implementations must be non-fatal — errors inside `end()` are swallowed.
 */
export interface Span {
  /** Sets a key-value attribute on the span. */
  setAttribute(key: string, value: string | number): void;
  /** Marks the span as complete. Implementations record duration and flush. */
  end(): void;
}

/**
 * Tracing sink interface for starting named spans.
 *
 * Three implementations are provided:
 *   - `NoopTraceSink`: silent, zero overhead (default when tracing disabled)
 *   - `StderrTraceSink`: logs span name + attrs + duration to stderr as JSON
 *   - `OtelTraceSink`: delegates to `@opentelemetry/api` when installed
 *
 * Use `createTraceSink(config)` to select the right implementation from config.
 */
export interface ObservabilitySink {
  /** Starts a new named span and returns it. */
  startSpan(name: string, attrs?: Record<string, string | number>): Span;
}

// ---------------------------------------------------------------------------
// NoopTraceSink
// ---------------------------------------------------------------------------

/** Noop span — all methods are no-ops with zero overhead. */
class NoopSpan implements Span {
  setAttribute(_key: string, _value: string | number): void {}
  end(): void {}
}

/**
 * No-op tracing sink.
 *
 * Default when `config.traces.enabled` is false or when no sink config is
 * present. Zero memory and CPU overhead — safe to use anywhere.
 *
 * @example
 * const sink = new NoopTraceSink();
 * const span = sink.startSpan("startup");
 * span.end(); // nothing happens
 */
export class NoopTraceSink implements ObservabilitySink {
  private static readonly NOOP_SPAN = new NoopSpan();

  /** Returns the shared noop span. */
  startSpan(_name: string, _attrs?: Record<string, string | number>): Span {
    return NoopTraceSink.NOOP_SPAN;
  }
}

// ---------------------------------------------------------------------------
// StderrTraceSink
// ---------------------------------------------------------------------------

/**
 * Stderr tracing span.
 *
 * Writes a JSON line to stderr on `end()` containing the span name, attributes,
 * and elapsed time in milliseconds. Safe for STDIO MCP transports (stdout is
 * reserved for MCP protocol traffic). Useful for local development visibility
 * without requiring an OTel collector.
 */
class StderrSpan implements Span {
  private readonly startedAt = Date.now();
  private readonly attrs: Record<string, string | number>;

  constructor(
    private readonly name: string,
    initialAttrs: Record<string, string | number> = {}
  ) {
    this.attrs = { ...initialAttrs };
  }

  setAttribute(key: string, value: string | number): void {
    this.attrs[key] = value;
  }

  end(): void {
    const durationMs = Date.now() - this.startedAt;
    const line = JSON.stringify({
      span: this.name,
      durationMs,
      attrs: this.attrs
    });

    process.stderr.write(`[agentic-ai-infra:trace] ${line}\n`);
  }
}

/**
 * Tracing sink that logs completed spans to stderr as JSON lines.
 *
 * Activates when `config.traces.enabled` is true and `config.traces.sink` is
 * `"local"`. No external dependencies required.
 *
 * @example
 * const sink = new StderrTraceSink();
 * const span = sink.startSpan("retrieval.retrieve", { query: "architecture" });
 * // ... do work ...
 * span.setAttribute("resultCount", 5);
 * span.end(); // writes JSON to stderr
 */
export class StderrTraceSink implements ObservabilitySink {
  startSpan(name: string, attrs?: Record<string, string | number>): Span {
    return new StderrSpan(name, attrs);
  }
}

// ---------------------------------------------------------------------------
// OtelTraceSink
// ---------------------------------------------------------------------------

/**
 * OTel tracing span adapter.
 *
 * Wraps an `@opentelemetry/api` span with the framework `Span` interface.
 * The OTel span is ended when `end()` is called; attributes set via
 * `setAttribute` are forwarded to the OTel span.
 */
class OtelSpan implements Span {
  constructor(private readonly otelSpan: {
    setAttribute(key: string, value: string | number): void;
    end(): void;
  }) {}

  setAttribute(key: string, value: string | number): void {
    this.otelSpan.setAttribute(key, value);
  }

  end(): void {
    this.otelSpan.end();
  }
}

/**
 * OTel tracing sink using `@opentelemetry/api` as an optional peer dependency.
 *
 * The OTel SDK is loaded via dynamic `require()` so the framework never crashes
 * when `@opentelemetry/api` is not installed. If the package is absent or the
 * require fails, `create()` returns a `StderrTraceSink` as a graceful fallback.
 *
 * ### Why optional peer dependency
 * Requiring `@opentelemetry/api` in `package.json` as a hard dependency would
 * force every consumer to install the OTel SDK even when they never enable
 * tracing. The dynamic require pattern keeps the SDK absent by default and lets
 * production deployments opt in by installing `@opentelemetry/api` and
 * configuring an OTLP exporter before starting the runtime.
 *
 * ### ESM / CJS compatibility
 * `require` is used (not dynamic `import()`) because OTel span creation is
 * synchronous. The require call is wrapped in try/catch so ESM-only runtimes
 * that block `require` fall back to `StderrTraceSink` gracefully.
 *
 * @example
 * // With @opentelemetry/api installed and an OTLP exporter configured:
 * const sink = OtelTraceSink.create();
 * const span = sink.startSpan("startup");
 * span.end();
 */
export class OtelTraceSink implements ObservabilitySink {
  private constructor(private readonly tracer: {
    startSpan(name: string): {
      setAttribute(key: string, value: string | number): void;
      end(): void;
    };
  }) {}

  /**
   * Creates an `OtelTraceSink` when `@opentelemetry/api` is installed, or falls
   * back to `StderrTraceSink` when the package is absent or the require fails.
   */
  static create(): ObservabilitySink {
    try {
      // Dynamic require keeps @opentelemetry/api as an optional peer dep.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const api = require("@opentelemetry/api") as {
        trace: { getTracer(name: string): {
          startSpan(name: string): {
            setAttribute(key: string, value: string | number): void;
            end(): void;
          };
        }};
      };

      return new OtelTraceSink(api.trace.getTracer("agentic-ai-infra"));
    } catch {
      return new StderrTraceSink();
    }
  }

  startSpan(name: string, attrs?: Record<string, string | number>): Span {
    const otelSpan = this.tracer.startSpan(name);

    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        otelSpan.setAttribute(key, value);
      }
    }

    return new OtelSpan(otelSpan);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Selects the appropriate tracing sink from the resolved observability config.
 *
 * | `traces.enabled` | `traces.sink` | Sink returned          |
 * |------------------|---------------|------------------------|
 * | false / absent   | any           | `NoopTraceSink`        |
 * | true             | "local"       | `StderrTraceSink`      |
 * | true             | "remote"      | `OtelTraceSink.create` |
 * | true             | other         | `NoopTraceSink`        |
 *
 * @param config - `ObservabilityConfig` from the resolved project config.
 *
 * @example
 * const sink = createTraceSink(resolvedConfig.observability);
 * const span = sink.startSpan("startLocalRuntime");
 * // ... startup work ...
 * span.end();
 */
export function createTraceSink(config: ObservabilityConfig): ObservabilitySink {
  if (!config.traces?.enabled) return new NoopTraceSink();

  if (config.traces.sink === "local") return new StderrTraceSink();

  if (config.traces.sink === "remote") return OtelTraceSink.create();

  return new NoopTraceSink();
}
