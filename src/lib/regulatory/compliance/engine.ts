/**
 * Compliance Engine
 *
 * Orchestrates the full regulatory compliance check:
 * 1. Run deterministic CAP Code rule checks
 * 2. Retrieve relevant regulatory context via RAG
 * 3. Run the Judge model (Claude 4.5 Haiku)
 * 4. Combine into a confidence score
 * 5. Route: ≥95% auto-send, <95% human review queue
 */

import { runAllCapRuleChecks, RuleCheckResult } from "../rules/cap-rules";
import { ComplianceJudge, JudgeVerdict } from "../judge/judge";
import { RagRetrieval, RetrievedChunk, RagResult } from "../rag/retrieval";

export type ComplianceDecision = "auto_send" | "human_review";

export interface ComplianceResult {
  /** The original claim text */
  claim: string;
  /** Final confidence score (0–100) */
  confidenceScore: number;
  /** Routing decision */
  decision: ComplianceDecision;
  /** Deterministic CAP Code rule results */
  ruleChecks: RuleCheckResult[];
  /** Judge model verdict (null if rules already failed hard) */
  judgeVerdict: JudgeVerdict | null;
  /** Retrieved regulatory chunks used for context */
  retrievedChunks: RetrievedChunk[];
  /** Rules that triggered failures or flags */
  triggeredRules: string[];
  /** Human-readable summary */
  summary: string;
}

const CONFIDENCE_THRESHOLD = 95;

export class ComplianceEngine {
  private judge: ComplianceJudge;
  private rag: RagRetrieval;

  constructor(judge: ComplianceJudge, rag: RagRetrieval) {
    this.judge = judge;
    this.rag = rag;
  }

  /**
   * Run the full compliance check on a marketing claim.
   *
   * Flow:
   * 1. Deterministic CAP Code rule checks (fast, no LLM)
   * 2. RAG retrieval for regulatory context
   * 3. Judge model evaluation (Claude 4.5 Haiku)
   * 4. Combine scores → routing decision
   */
  async checkCompliance(claim: string): Promise<ComplianceResult> {
    // Step 1: Deterministic CAP Code rule checks
    const ruleChecks = runAllCapRuleChecks(claim);
    const triggeredRules: string[] = [];

    // Calculate rule-based confidence penalty
    let rulePenalty = 0;
    for (const check of ruleChecks) {
      if (!check.passed) {
        triggeredRules.push(check.rule);
        rulePenalty += check.confidencePenalty;
      }
    }

    // If any rule has a 100% penalty (hard fail), short-circuit
    const hardFail = ruleChecks.some(
      (c) => !c.passed && c.confidencePenalty >= 100
    );

    if (hardFail) {
      return {
        claim,
        confidenceScore: 0,
        decision: "human_review",
        ruleChecks,
        judgeVerdict: null,
        retrievedChunks: [],
        triggeredRules,
        summary: `FAILED — Hard rule violation(s): ${triggeredRules.join(", ")}. ${ruleChecks
          .filter((c) => !c.passed)
          .map((c) => c.reason)
          .join("; ")}`,
      };
    }

    // Step 2: RAG retrieval
    const ragResults = await this.rag.search(claim, 5, 0.3);
    const retrievedChunks: RetrievedChunk[] = ragResults.map((r: RagResult) => ({
      regulationText: r.chunk.text,
      sourceAuthority: r.chunk.sourceAuthority,
      ruleNumber: r.chunk.ruleNumber || "",
      similarityScore: r.score,
    }));

    // Step 3: Judge model evaluation
    let judgeVerdict: JudgeVerdict;
    try {
      judgeVerdict = await this.judge.evaluate(claim, retrievedChunks);
    } catch (error) {
      // If judge fails, route to human review
      return {
        claim,
        confidenceScore: 0,
        decision: "human_review",
        ruleChecks,
        judgeVerdict: null,
        retrievedChunks,
        triggeredRules: [...triggeredRules, "JUDGE_ERROR"],
        summary: `REVIEW — Judge model error: ${error instanceof Error ? error.message : "Unknown error"}. Routing to human review.`,
      };
    }

    // Step 4: Calculate final confidence score
    let confidenceScore = judgeVerdict.confidenceScore;

    // Apply rule-based penalties
    confidenceScore = Math.max(0, confidenceScore - rulePenalty);

    // If judge failed any rubric point, cap at 50%
    if (!judgeVerdict.overallPass) {
      confidenceScore = Math.min(confidenceScore, 50);
      for (const point of judgeVerdict.rubric) {
        if (!point.passed) {
          triggeredRules.push(`JUDGE_${point.criterion.toUpperCase()}`);
        }
      }
    }

    // Step 5: Route
    const decision: ComplianceDecision =
      confidenceScore >= CONFIDENCE_THRESHOLD ? "auto_send" : "human_review";

    const summary = decision === "auto_send"
      ? `PASSED — Confidence: ${confidenceScore}%. All checks passed.`
      : `REVIEW — Confidence: ${confidenceScore}%. Triggered: ${triggeredRules.join(", ") || "low confidence"}. ${judgeVerdict.reasoning}`;

    return {
      claim,
      confidenceScore,
      decision,
      ruleChecks,
      judgeVerdict,
      retrievedChunks,
      triggeredRules,
      summary,
    };
  }
}
