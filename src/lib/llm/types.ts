/**
 * Dynamic LLM Router Types
 *
 * Defines task types, model configs, and routing decisions.
 */

export type LLMTaskType =
  | "compliance_verification"
  | "long_document_parsing"
  | "outreach_messaging"
  | "content_brief_generation"
  | "general";

export interface ModelConfig {
  /** Model identifier for the API */
  modelId: string;
  /** Provider: openai, anthropic, google */
  provider: "openai" | "anthropic" | "google";
  /** Predicted quality score (0–100) */
  qualityScore: number;
  /** Cost per 1K input tokens (GBP) */
  costPerKInput: number;
  /** Cost per 1K output tokens (GBP) */
  costPerKOutput: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Max context window in tokens */
  maxContextTokens: number;
  /** Human-readable name */
  displayName: string;
}

export interface RouterWeights {
  /** Weight for quality in routing decision (0–1) */
  quality: number;
  /** Weight for cost in routing decision (0–1) */
  cost: number;
  /** Weight for latency in routing decision (0–1) */
  latency: number;
}

export interface RoutingDecision {
  /** Selected model */
  model: ModelConfig;
  /** Task type that was routed */
  taskType: LLMTaskType;
  /** Composite score that determined the selection */
  routingScore: number;
  /** Reasoning for the selection */
  reason: string;
}

export interface LLMCallOptions {
  /** Task type for routing */
  taskType: LLMTaskType;
  /** System prompt */
  systemPrompt?: string;
  /** User message */
  userMessage: string;
  /** Max tokens for response */
  maxTokens?: number;
  /** Temperature */
  temperature?: number;
  /** Additional metadata for LangSmith tracing */
  metadata?: Record<string, unknown>;
  /** Force a specific model (bypasses router optimization) */
  forceModel?: string;
}

export interface LLMCallResult {
  /** The generated text */
  text: string;
  /** Which model was used */
  model: ModelConfig;
  /** Routing decision details */
  routing: RoutingDecision;
  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Estimated cost in GBP */
  estimatedCostGBP: number;
  /** Actual latency in ms */
  latencyMs: number;
}
