/**
 * OPA Policy Engine
 *
 * Enforces three Financial Circuit Breakers:
 * 1. Velocity Monitor — LLM API costs exceed £50 in 10 minutes → halt ALL agent activity
 * 2. Commission Cap — Commission pushes margin below threshold → block collaboration
 * 3. Loop Detector — Same API call repeated without progress → auto-terminate process
 *
 * All breaker activations are logged to LangSmith with full context.
 * Non-bypassable: wired into every agent action at the orchestration layer.
 */

import { Pool } from "pg";
import { traced } from "@/lib/llm/langsmith";
import { ProfitabilityEngine } from "@/lib/profitability/engine";
import {
  PolicyResult,
  PolicyEvaluationResult,
  PolicyContext,
  LLMCostRecord,
  APICallRecord,
  OPAPolicyConfig,
  DEFAULT_OPA_CONFIG,
} from "./types";

// ─── Admin Alert Callback ───

export type OPAAlertFn = (alert: {
  level: "critical" | "error" | "warning";
  breaker: string;
  message: string;
  details?: unknown;
}) => void;

let opaAlert: OPAAlertFn = (alert) => {
  console.error(
    `[OPAPolicy] [${alert.level}] ${alert.breaker}: ${alert.message}`
  );
};

export function setOPAAlert(fn: OPAAlertFn): void {
  opaAlert = fn;
}

export class OPAPolicyEngine {
  private db: Pool;
  private profitabilityEngine: ProfitabilityEngine;
  private config: OPAPolicyConfig;

  // In-memory cost tracking (sliding window)
  private costRecords: LLMCostRecord[] = [];

  // In-memory loop detection
  private callRecords: Map<string, APICallRecord[]> = new Map();

  // Global halt flag (velocity breaker)
  private _halted = false;

  constructor(
    db: Pool,
    profitabilityEngine: ProfitabilityEngine,
    config?: Partial<OPAPolicyConfig>
  ) {
    this.db = db;
    this.profitabilityEngine = profitabilityEngine;
    this.config = { ...DEFAULT_OPA_CONFIG, ...config };
  }

  /**
   * Evaluate all applicable policies for an action.
   * This is the single entry point for policy enforcement.
   */
  async evaluate(context: PolicyContext): Promise<PolicyEvaluationResult> {
    const tracedEvaluate = traced(
      async (ctx: PolicyContext): Promise<PolicyEvaluationResult> => {
        return this._evaluateInternal(ctx);
      },
      {
        name: "opa-policy-evaluate",
        runType: "tool",
        metadata: {
          actionType: context.actionType,
          productSku: context.productSku,
        },
      }
    );

    return tracedEvaluate(context);
  }

  private async _evaluateInternal(
    context: PolicyContext
  ): Promise<PolicyEvaluationResult> {
    const results: PolicyResult[] = [];

    // 1. Velocity monitor — applies to ALL actions
    const velocityResult = this.checkVelocity(context);
    results.push(velocityResult);

    // 2. Commission cap — applies to collaboration_create and mcf_order
    if (
      context.actionType === "collaboration_create" ||
      context.actionType === "mcf_order"
    ) {
      if (
        context.productSku &&
        context.salePrice !== undefined &&
        context.proposedCommissionPercent !== undefined
      ) {
        const commissionResult = await this.checkCommissionCap(context);
        results.push(commissionResult);
      }
    }

    // 3. Loop detector — applies to api_call and llm_call
    if (
      context.actionType === "api_call" ||
      context.actionType === "llm_call"
    ) {
      if (context.callKey !== undefined) {
        const loopResult = this.checkLoopDetector(context);
        results.push(loopResult);
      }
    }

    // Determine overall result
    const denied = results.find((r) => !r.allowed);
    const evaluation: PolicyEvaluationResult = {
      allowed: !denied,
      results,
      deniedBy: denied?.checkType,
      evaluatedAt: new Date(),
    };

    // Log denials
    if (denied) {
      opaAlert({
        level: denied.checkType === "velocity_monitor" ? "critical" : "error",
        breaker: denied.checkType,
        message: denied.reason,
        details: {
          context,
          evaluation,
        },
      });
    }

    return evaluation;
  }

  // ─── Velocity Monitor ───

  /**
   * Check if LLM spending has exceeded the velocity limit.
   * Trigger: £50 in 10 minutes → halt ALL agent activity.
   */
  private checkVelocity(context: PolicyContext): PolicyResult {
    // If halted globally, deny everything
    if (this._halted) {
      return {
        allowed: false,
        checkType: "velocity_monitor",
        reason: `Agent activity halted: LLM spending exceeded £${this.config.velocityMaxSpendGBP} in ${this.config.velocityWindowMs / 60000} minutes. Manual reset required.`,
        metadata: { halted: true },
      };
    }

    // Record new LLM cost if this is an LLM call
    if (
      context.actionType === "llm_call" &&
      context.estimatedCostGBP !== undefined
    ) {
      this.recordLLMCost({
        timestamp: new Date(),
        modelId: context.modelId || "unknown",
        costGBP: context.estimatedCostGBP,
        taskType: context.taskType || "unknown",
      });
    }

    // Check current window spend
    const windowSpend = this.getWindowSpend();

    if (windowSpend >= this.config.velocityMaxSpendGBP) {
      this._halted = true;
      return {
        allowed: false,
        checkType: "velocity_monitor",
        reason: `Velocity breaker triggered: £${windowSpend.toFixed(2)} spent in last ${this.config.velocityWindowMs / 60000} minutes (limit: £${this.config.velocityMaxSpendGBP}).`,
        metadata: {
          windowSpend,
          limit: this.config.velocityMaxSpendGBP,
          windowMs: this.config.velocityWindowMs,
        },
      };
    }

    return {
      allowed: true,
      checkType: "velocity_monitor",
      reason: `Velocity OK: £${windowSpend.toFixed(2)} / £${this.config.velocityMaxSpendGBP} in window.`,
      metadata: { windowSpend },
    };
  }

  /**
   * Record an LLM call cost.
   */
  recordLLMCost(record: LLMCostRecord): void {
    this.costRecords.push(record);
    this.pruneOldCostRecords();
  }

  /**
   * Get total LLM spend in the current sliding window.
   */
  getWindowSpend(): number {
    this.pruneOldCostRecords();
    return this.costRecords.reduce((sum, r) => sum + r.costGBP, 0);
  }

  private pruneOldCostRecords(): void {
    const cutoff = new Date(Date.now() - this.config.velocityWindowMs);
    this.costRecords = this.costRecords.filter((r) => r.timestamp >= cutoff);
  }

  // ─── Commission Cap ───

  /**
   * Check if a proposed commission would push margin below threshold.
   */
  private async checkCommissionCap(
    context: PolicyContext
  ): Promise<PolicyResult> {
    try {
      const { allowed, cap } =
        await this.profitabilityEngine.isCommissionProfitable(
          context.productSku!,
          context.salePrice!,
          context.proposedCommissionPercent!,
          { category: context.productCategory }
        );

      if (!allowed) {
        return {
          allowed: false,
          checkType: "commission_cap",
          reason: `Commission cap exceeded: proposed ${context.proposedCommissionPercent}% (£${cap.proposedCommissionGBP}) exceeds max ${cap.maxCommissionPercent}% (£${cap.maxCommissionGBP}) for SKU ${context.productSku}.`,
          metadata: { cap },
        };
      }

      return {
        allowed: true,
        checkType: "commission_cap",
        reason: `Commission OK: ${context.proposedCommissionPercent}% within cap of ${cap.maxCommissionPercent}%.`,
        metadata: { cap },
      };
    } catch (error) {
      // If profitability data is missing, deny as a safety measure
      return {
        allowed: false,
        checkType: "commission_cap",
        reason: `Commission check failed: ${(error as Error).message}. Denying as safety measure.`,
        metadata: { error: (error as Error).message },
      };
    }
  }

  // ─── Loop Detector ───

  /**
   * Check if the same API call is being repeated without progress.
   */
  private checkLoopDetector(context: PolicyContext): PolicyResult {
    const callKey = context.callKey!;
    const now = new Date();

    // Record this call
    if (!this.callRecords.has(callKey)) {
      this.callRecords.set(callKey, []);
    }

    const records = this.callRecords.get(callKey)!;
    records.push({
      callKey,
      timestamp: now,
      madeProgress: context.madeProgress ?? false,
    });

    // Prune old records
    const cutoff = new Date(now.getTime() - this.config.loopWindowMs);
    const recentRecords = records.filter((r) => r.timestamp >= cutoff);
    this.callRecords.set(callKey, recentRecords);

    // Count consecutive calls without progress
    const noProgressCount = this.countConsecutiveNoProgress(recentRecords);

    if (noProgressCount >= this.config.loopMaxRepetitions) {
      return {
        allowed: false,
        checkType: "loop_detector",
        reason: `Loop detected: API call "${callKey}" repeated ${noProgressCount} times without progress. Process auto-terminated.`,
        metadata: {
          callKey,
          repetitions: noProgressCount,
          limit: this.config.loopMaxRepetitions,
        },
      };
    }

    return {
      allowed: true,
      checkType: "loop_detector",
      reason: `No loop detected: "${callKey}" at ${noProgressCount}/${this.config.loopMaxRepetitions} repetitions.`,
      metadata: { callKey, repetitions: noProgressCount },
    };
  }

  /**
   * Count consecutive calls without progress (from the end).
   */
  private countConsecutiveNoProgress(records: APICallRecord[]): number {
    let count = 0;
    for (let i = records.length - 1; i >= 0; i--) {
      if (!records[i].madeProgress) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  // ─── Control Methods ───

  /**
   * Whether the velocity breaker has halted all activity.
   */
  isHalted(): boolean {
    return this._halted;
  }

  /**
   * Manually reset the velocity breaker (admin action).
   */
  resetVelocityBreaker(): void {
    this._halted = false;
    this.costRecords = [];
    opaAlert({
      level: "warning",
      breaker: "velocity_monitor",
      message: "Velocity breaker manually reset by admin.",
    });
  }

  /**
   * Clear loop detection records for a specific call key (or all).
   */
  clearLoopRecords(callKey?: string): void {
    if (callKey) {
      this.callRecords.delete(callKey);
    } else {
      this.callRecords.clear();
    }
  }

  /**
   * Get current cost records (for dashboard display).
   */
  getCostRecords(): readonly LLMCostRecord[] {
    this.pruneOldCostRecords();
    return [...this.costRecords];
  }

  /**
   * Get loop detection state for a call key.
   */
  getLoopState(callKey: string): { count: number; records: APICallRecord[] } {
    const records = this.callRecords.get(callKey) || [];
    return {
      count: this.countConsecutiveNoProgress(records),
      records: [...records],
    };
  }

  /** Expose config for testing */
  getConfig(): Readonly<OPAPolicyConfig> {
    return { ...this.config };
  }
}
