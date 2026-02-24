/**
 * LangSmith Tracing Wrapper
 *
 * All LLM calls in the codebase go through this module.
 * Provides the `traced` function that wraps any function with
 * LangSmith observability (inputs, outputs, metadata, cost, latency).
 */

import { traceable } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers";

export interface TraceOptions {
  /** Name of the trace (shown in LangSmith UI) */
  name: string;
  /** Run type: "llm", "chain", "tool", "retriever" */
  runType?: string;
  /** Additional metadata for the trace */
  metadata?: Record<string, unknown>;
}

/**
 * Wrap a function with LangSmith tracing.
 *
 * Usage:
 *   const tracedFn = traced(
 *     async (input: string) => { ... },
 *     { name: "my-operation", runType: "tool" }
 *   );
 *   const result = await tracedFn("hello");
 */
export function traced<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  options: TraceOptions
): (...args: TArgs) => TReturn {
  return traceable(fn, {
    name: options.name,
    run_type: options.runType as "llm" | "chain" | "tool" | "retriever" | undefined,
    metadata: options.metadata,
  }) as unknown as (...args: TArgs) => TReturn;
}

export { wrapOpenAI };
