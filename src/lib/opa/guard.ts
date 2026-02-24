/**
 * OPA Policy Guard
 *
 * Non-bypassable enforcement layer wired into every agent action.
 * All agent operations MUST call the guard before executing.
 *
 * Enforced at orchestration layer:
 * - No collaboration without commission cap check
 * - No MCF order without profitability verification
 * - No LLM call without velocity monitor check
 * - No message without loop detection clearance
 */

import { traced } from "@/lib/llm/langsmith";
import { OPAPolicyEngine } from "./policy-engine";
import { PolicyContext, PolicyEvaluationResult } from "./types";

/**
 * Error thrown when a policy check denies an action.
 * Catch this to handle policy denials gracefully.
 */
export class PolicyDeniedError extends Error {
  public readonly evaluation: PolicyEvaluationResult;
  public readonly context: PolicyContext;

  constructor(evaluation: PolicyEvaluationResult, context: PolicyContext) {
    const deniedResult = evaluation.results.find((r) => !r.allowed);
    super(
      `Policy denied: ${deniedResult?.reason || "Unknown policy violation"}`
    );
    this.name = "PolicyDeniedError";
    this.evaluation = evaluation;
    this.context = context;
  }
}

/**
 * OPA Policy Guard — the single enforcement point for all agent actions.
 *
 * Usage:
 *   const guard = new OPAPolicyGuard(engine);
 *
 *   // Before any collaboration:
 *   await guard.checkCollaboration(sku, price, commissionPercent);
 *
 *   // Before any MCF order:
 *   await guard.checkFulfillment(sku, price, commissionPercent);
 *
 *   // Before any LLM call:
 *   await guard.checkLLMCall(estimatedCost, modelId, taskType);
 *
 *   // Before any message:
 *   await guard.checkMessage(callKey);
 *
 *   // Generic: wrap any action
 *   await guard.enforce(context);
 */
export class OPAPolicyGuard {
  private engine: OPAPolicyEngine;

  constructor(engine: OPAPolicyEngine) {
    this.engine = engine;
  }

  /**
   * Enforce policy for a generic action context.
   * Throws PolicyDeniedError if any policy check fails.
   */
  async enforce(context: PolicyContext): Promise<PolicyEvaluationResult> {
    const tracedEnforce = traced(
      async (ctx: PolicyContext): Promise<PolicyEvaluationResult> => {
        const evaluation = await this.engine.evaluate(ctx);

        if (!evaluation.allowed) {
          throw new PolicyDeniedError(evaluation, ctx);
        }

        return evaluation;
      },
      {
        name: "opa-guard-enforce",
        runType: "tool",
        metadata: { actionType: context.actionType },
      }
    );

    return tracedEnforce(context);
  }

  /**
   * Check policy before creating a collaboration.
   * Validates: velocity monitor + commission cap.
   */
  async checkCollaboration(
    productSku: string,
    salePrice: number,
    proposedCommissionPercent: number,
    productCategory?: string
  ): Promise<PolicyEvaluationResult> {
    return this.enforce({
      actionType: "collaboration_create",
      productSku,
      salePrice,
      proposedCommissionPercent,
      productCategory,
    });
  }

  /**
   * Check policy before creating an MCF fulfillment order.
   * Validates: velocity monitor + commission cap.
   */
  async checkFulfillment(
    productSku: string,
    salePrice: number,
    proposedCommissionPercent: number,
    productCategory?: string
  ): Promise<PolicyEvaluationResult> {
    return this.enforce({
      actionType: "mcf_order",
      productSku,
      salePrice,
      proposedCommissionPercent,
      productCategory,
    });
  }

  /**
   * Check policy before making an LLM call.
   * Validates: velocity monitor (records cost).
   */
  async checkLLMCall(
    estimatedCostGBP: number,
    modelId: string,
    taskType: string
  ): Promise<PolicyEvaluationResult> {
    return this.enforce({
      actionType: "llm_call",
      estimatedCostGBP,
      modelId,
      taskType,
    });
  }

  /**
   * Check policy before sending a message or making an API call.
   * Validates: velocity monitor + loop detector.
   */
  async checkAPICall(
    callKey: string,
    madeProgress: boolean = true
  ): Promise<PolicyEvaluationResult> {
    return this.enforce({
      actionType: "api_call",
      callKey,
      madeProgress,
    });
  }

  /**
   * Check policy before sending a message.
   * Validates: velocity monitor.
   */
  async checkMessage(): Promise<PolicyEvaluationResult> {
    return this.enforce({
      actionType: "message_send",
    });
  }

  /**
   * Non-throwing version of enforce.
   * Returns the evaluation result without throwing.
   */
  async evaluateOnly(
    context: PolicyContext
  ): Promise<PolicyEvaluationResult> {
    return this.engine.evaluate(context);
  }

  /**
   * Whether the velocity breaker has halted all activity.
   */
  isHalted(): boolean {
    return this.engine.isHalted();
  }
}
