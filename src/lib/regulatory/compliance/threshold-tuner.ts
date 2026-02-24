/**
 * Confidence Threshold Tuner
 *
 * Uses evaluation data (from LangSmith or manual review queue) to
 * analyze confidence score distribution vs human verdicts and
 * recommend threshold adjustments.
 *
 * Default threshold: 95%
 * Rule 15.6.4 (fear-based language) should consistently route to human review.
 */

import { Pool } from "pg";

export interface ThresholdAnalysis {
  currentThreshold: number;
  recommendedThreshold: number;
  totalEvaluations: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  rule15_6_4Stats: {
    totalFlagged: number;
    humanAgreed: number;
    humanOverruled: number;
    routingRate: number;
  };
  rationale: string;
}

export interface EvaluationRecord {
  confidenceScore: number;
  decision: "approved" | "rejected" | "edited";
  triggeredRules: string[];
  humanVerdict: "correct" | "incorrect";
}

export class ThresholdTuner {
  private db: Pool;
  private currentThreshold: number;

  constructor(db: Pool, currentThreshold = 95) {
    this.db = db;
    this.currentThreshold = currentThreshold;
  }

  /**
   * Analyze the review queue data to recommend threshold adjustments.
   * Compares confidence scores against human decisions.
   */
  async analyze(): Promise<ThresholdAnalysis> {
    // Fetch completed reviews with decisions
    const result = await this.db.query(`
      SELECT confidence_score, decision, triggered_rules
      FROM review_queue
      WHERE decision != 'pending'
      ORDER BY created_at DESC
      LIMIT 1000
    `);

    const records: EvaluationRecord[] = result.rows.map((row) => ({
      confidenceScore: parseFloat(String(row.confidence_score)),
      decision: row.decision as "approved" | "rejected" | "edited",
      triggeredRules: (row.triggered_rules as string[]) || [],
      humanVerdict:
        row.decision === "approved" ? "correct" : "incorrect",
    }));

    const totalEvaluations = records.length;

    if (totalEvaluations === 0) {
      return {
        currentThreshold: this.currentThreshold,
        recommendedThreshold: this.currentThreshold,
        totalEvaluations: 0,
        truePositives: 0,
        falsePositives: 0,
        trueNegatives: 0,
        falseNegatives: 0,
        precision: 0,
        recall: 0,
        f1Score: 0,
        rule15_6_4Stats: {
          totalFlagged: 0,
          humanAgreed: 0,
          humanOverruled: 0,
          routingRate: 0,
        },
        rationale:
          "Insufficient evaluation data. Maintaining default threshold of 95%.",
      };
    }

    // Calculate confusion matrix at current threshold
    // TP = correctly auto-sent (score >= threshold AND human would approve)
    // FP = incorrectly auto-sent (score >= threshold BUT human rejects)
    // TN = correctly routed to review (score < threshold AND human rejects)
    // FN = unnecessarily routed to review (score < threshold BUT human approves)
    let tp = 0,
      fp = 0,
      tn = 0,
      fn = 0;

    for (const record of records) {
      const autoSend = record.confidenceScore >= this.currentThreshold;
      const humanApproved = record.decision === "approved";

      if (autoSend && humanApproved) tp++;
      else if (autoSend && !humanApproved) fp++;
      else if (!autoSend && !humanApproved) tn++;
      else if (!autoSend && humanApproved) fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1Score =
      precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;

    // Analyze Rule 15.6.4 specifically
    const rule15_6_4Records = records.filter((r) =>
      r.triggeredRules.includes("15.6.4")
    );
    const rule15_6_4Approved = rule15_6_4Records.filter(
      (r) => r.decision === "approved"
    );

    const rule15_6_4Stats = {
      totalFlagged: rule15_6_4Records.length,
      humanAgreed: rule15_6_4Records.length - rule15_6_4Approved.length,
      humanOverruled: rule15_6_4Approved.length,
      routingRate:
        rule15_6_4Records.length > 0
          ? rule15_6_4Records.filter(
              (r) => r.confidenceScore < this.currentThreshold
            ).length / rule15_6_4Records.length
          : 0,
    };

    // Find optimal threshold by testing thresholds 80-99
    let bestThreshold = this.currentThreshold;
    let bestF1 = f1Score;

    for (let t = 80; t <= 99; t++) {
      let testTp = 0,
        testFp = 0,
        testFn = 0;
      for (const record of records) {
        const autoSend = record.confidenceScore >= t;
        const humanApproved = record.decision === "approved";
        if (autoSend && humanApproved) testTp++;
        else if (autoSend && !humanApproved) testFp++;
        else if (!autoSend && humanApproved) testFn++;
      }
      const testPrecision =
        testTp + testFp > 0 ? testTp / (testTp + testFp) : 0;
      const testRecall =
        testTp + testFn > 0 ? testTp / (testTp + testFn) : 0;
      const testF1 =
        testPrecision + testRecall > 0
          ? (2 * testPrecision * testRecall) /
            (testPrecision + testRecall)
          : 0;
      if (testF1 > bestF1) {
        bestF1 = testF1;
        bestThreshold = t;
      }
    }

    // Generate rationale
    let rationale = "";
    if (bestThreshold === this.currentThreshold) {
      rationale = `Current threshold of ${this.currentThreshold}% is optimal based on ${totalEvaluations} evaluations. F1 score: ${f1Score.toFixed(3)}.`;
    } else {
      rationale = `Recommending adjustment from ${this.currentThreshold}% to ${bestThreshold}% based on ${totalEvaluations} evaluations. F1 improves from ${f1Score.toFixed(3)} to ${bestF1.toFixed(3)}.`;
    }

    if (rule15_6_4Stats.routingRate < 0.9 && rule15_6_4Stats.totalFlagged > 5) {
      rationale += ` WARNING: Rule 15.6.4 (fear-based language) routing rate is ${(rule15_6_4Stats.routingRate * 100).toFixed(0)}% — should be consistently >90%. Consider lowering confidence for this rule.`;
    }

    return {
      currentThreshold: this.currentThreshold,
      recommendedThreshold: bestThreshold,
      totalEvaluations,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      precision,
      recall,
      f1Score,
      rule15_6_4Stats,
      rationale,
    };
  }

  /**
   * Apply the recommended threshold.
   */
  setThreshold(newThreshold: number): void {
    if (newThreshold < 50 || newThreshold > 100) {
      throw new Error("Threshold must be between 50 and 100");
    }
    this.currentThreshold = newThreshold;
  }

  getThreshold(): number {
    return this.currentThreshold;
  }
}
