/**
 * OPA Policy Engine Types
 *
 * Three Financial Circuit Breakers:
 * 1. Velocity Monitor — LLM API costs exceed £50 in 10 minutes → halt all
 * 2. Commission Cap — Commission pushes margin below threshold → block
 * 3. Loop Detector — Same API call repeated without progress → auto-terminate
 */

/**
 * Types of policy checks.
 */
export type PolicyCheckType =
  | "velocity_monitor"
  | "commission_cap"
  | "loop_detector";

/**
 * Result of a policy evaluation.
 */
export interface PolicyResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Which policy check was evaluated */
  checkType: PolicyCheckType;
  /** Human-readable reason (especially for denials) */
  reason: string;
  /** Additional context for logging */
  metadata?: Record<string, unknown>;
}

/**
 * Combined result of all policy checks for an action.
 */
export interface PolicyEvaluationResult {
  /** Whether all policies allow the action */
  allowed: boolean;
  /** Results from each individual policy check */
  results: PolicyResult[];
  /** If denied, which policy triggered the denial */
  deniedBy?: PolicyCheckType;
  /** Timestamp of the evaluation */
  evaluatedAt: Date;
}

/**
 * LLM cost record for velocity tracking.
 */
export interface LLMCostRecord {
  /** Timestamp of the LLM call */
  timestamp: Date;
  /** Model used */
  modelId: string;
  /** Cost in GBP */
  costGBP: number;
  /** Task type */
  taskType: string;
}

/**
 * API call record for loop detection.
 */
export interface APICallRecord {
  /** Unique key identifying the call (method + params hash) */
  callKey: string;
  /** Timestamp of the call */
  timestamp: Date;
  /** Whether progress was made (response changed from previous) */
  madeProgress: boolean;
}

/**
 * Configuration for the OPA Policy Engine.
 */
export interface OPAPolicyConfig {
  /** Velocity monitor: max LLM spend in GBP within the window */
  velocityMaxSpendGBP: number;
  /** Velocity monitor: time window in ms (default: 10 minutes) */
  velocityWindowMs: number;
  /** Loop detector: max identical calls without progress before termination */
  loopMaxRepetitions: number;
  /** Loop detector: time window to consider for repetitions in ms */
  loopWindowMs: number;
  /** Whether the velocity breaker has been manually reset */
  velocityBreakerActive: boolean;
}

export const DEFAULT_OPA_CONFIG: OPAPolicyConfig = {
  velocityMaxSpendGBP: 50,
  velocityWindowMs: 10 * 60 * 1000, // 10 minutes
  loopMaxRepetitions: 10,
  loopWindowMs: 5 * 60 * 1000, // 5 minutes
  velocityBreakerActive: false,
};

/**
 * Action types that require policy checks.
 */
export type AgentActionType =
  | "llm_call"
  | "collaboration_create"
  | "mcf_order"
  | "message_send"
  | "api_call";

/**
 * Context provided to the policy engine for evaluation.
 */
export interface PolicyContext {
  /** What type of action is being attempted */
  actionType: AgentActionType;
  /** For commission checks: product SKU */
  productSku?: string;
  /** For commission checks: sale price in GBP */
  salePrice?: number;
  /** For commission checks: proposed commission percentage */
  proposedCommissionPercent?: number;
  /** For commission checks: product category */
  productCategory?: string;
  /** For LLM calls: estimated cost in GBP */
  estimatedCostGBP?: number;
  /** For LLM calls: model being used */
  modelId?: string;
  /** For LLM calls: task type */
  taskType?: string;
  /** For loop detection: call signature key */
  callKey?: string;
  /** For loop detection: whether progress was made */
  madeProgress?: boolean;
}
