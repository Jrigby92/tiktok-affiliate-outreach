/**
 * Compliance Engine Integration Tests
 *
 * Tests the full compliance pipeline with mocked judge model.
 * Verifies confidence routing: ≥95% auto-send, <95% human review.
 */

import { ComplianceEngine } from "@/lib/regulatory/compliance/engine";
import { ComplianceJudge } from "@/lib/regulatory/judge/judge";
import { RagRetrieval } from "@/lib/regulatory/rag/retrieval";

// Mock the judge model
const mockJudge = {
  evaluate: jest.fn(),
} as unknown as ComplianceJudge;

// Mock RAG retrieval — returns RagResult[] shape
const mockRag = {
  search: jest.fn().mockResolvedValue([
    {
      chunk: {
        text: 'AUTHORIZED HEALTH CLAIM — Vitamin D\nClaim: "Vitamin D contributes to the normal function of the immune system"',
        sourceAuthority: "MHRA",
        ruleNumber: "NHC-VitaminD",
        lastAccessed: new Date(),
      },
      score: 0.92,
    },
  ]),
} as unknown as RagRetrieval;

describe("Compliance Engine", () => {
  let engine: ComplianceEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new ComplianceEngine(mockJudge, mockRag);
  });

  // ✅ Known-good claim
  it("should PASS: 'Vitamin D contributes to the normal function of the immune system'", async () => {
    (mockJudge.evaluate as jest.Mock).mockResolvedValue({
      rubric: [
        { criterion: "faithfulness", passed: true, reasoning: "Claim matches GB NHC Register" },
        { criterion: "prohibited_terms", passed: true, reasoning: "No prohibited terms" },
        { criterion: "dosage_accuracy", passed: true, reasoning: "No dosage mentioned" },
      ],
      overallPass: true,
      confidenceScore: 98,
      reasoning: "Authorized SHC from the register. Fully compliant.",
    });

    const result = await engine.checkCompliance(
      "Vitamin D contributes to the normal function of the immune system"
    );

    expect(result.confidenceScore).toBeGreaterThanOrEqual(95);
    expect(result.decision).toBe("auto_send");
    expect(result.triggeredRules).toHaveLength(0);
  });

  // ❌ Banned word "cures" — Rule 15.6.2
  it("should FAIL: 'This supplement cures colds' — hard rule violation", async () => {
    const result = await engine.checkCompliance(
      "This supplement cures colds"
    );

    expect(result.confidenceScore).toBe(0);
    expect(result.decision).toBe("human_review");
    expect(result.triggeredRules).toContain("15.6.2");
    // Judge should NOT be called — hard fail short-circuits
    expect(mockJudge.evaluate).not.toHaveBeenCalled();
  });

  // ❌ Orphaned GHC — Rule 15.2
  it("should FAIL: 'Supports overall good health' (alone) — orphaned GHC", async () => {
    const result = await engine.checkCompliance(
      "Supports overall good health"
    );

    expect(result.confidenceScore).toBe(0);
    expect(result.decision).toBe("human_review");
    expect(result.triggeredRules).toContain("15.2");
    expect(mockJudge.evaluate).not.toHaveBeenCalled();
  });

  // ❌ Specific weight loss — Rule 15.6.6
  it("should FAIL: 'Lose 5kg in 2 weeks with our fat burner'", async () => {
    const result = await engine.checkCompliance(
      "Lose 5kg in 2 weeks with our fat burner"
    );

    expect(result.confidenceScore).toBe(0);
    expect(result.decision).toBe("human_review");
    expect(result.triggeredRules).toContain("15.6.6");
  });

  // ❌ Fear-based language — Rule 15.6.4 (flag for review, not hard fail)
  it("should FLAG: 'Without this vitamin, your bones will deteriorate' — human review", async () => {
    (mockJudge.evaluate as jest.Mock).mockResolvedValue({
      rubric: [
        { criterion: "faithfulness", passed: true, reasoning: "OK" },
        { criterion: "prohibited_terms", passed: true, reasoning: "OK" },
        { criterion: "dosage_accuracy", passed: true, reasoning: "OK" },
      ],
      overallPass: true,
      confidenceScore: 75,
      reasoning: "Fear-based language detected.",
    });

    const result = await engine.checkCompliance(
      "Without this vitamin, your bones will deteriorate"
    );

    // Should route to human review due to 15.6.4 penalty
    expect(result.decision).toBe("human_review");
    expect(result.confidenceScore).toBeLessThan(95);
    expect(result.triggeredRules).toContain("15.6.4");
  });

  // ❌ Dosage accuracy — Judge model catches it
  it("should FAIL via judge: 'Take 10g of creatine daily' — wrong dosage", async () => {
    (mockJudge.evaluate as jest.Mock).mockResolvedValue({
      rubric: [
        { criterion: "faithfulness", passed: true, reasoning: "Creatine claim exists in register" },
        { criterion: "prohibited_terms", passed: true, reasoning: "No prohibited terms" },
        {
          criterion: "dosage_accuracy",
          passed: false,
          reasoning: "Register specifies 3g of creatine, not 10g. Dosage inaccurate.",
        },
      ],
      overallPass: false,
      confidenceScore: 30,
      reasoning: "Dosage of 10g exceeds the authorized 3g per day.",
    });

    const result = await engine.checkCompliance(
      "Take 10g of creatine daily for improved physical performance"
    );

    expect(result.decision).toBe("human_review");
    expect(result.confidenceScore).toBeLessThanOrEqual(50);
    expect(result.triggeredRules).toContain("JUDGE_DOSAGE_ACCURACY");
  });

  // ─── Routing verification ───

  it("should route ≥95% confidence to auto_send", async () => {
    (mockJudge.evaluate as jest.Mock).mockResolvedValue({
      rubric: [
        { criterion: "faithfulness", passed: true, reasoning: "OK" },
        { criterion: "prohibited_terms", passed: true, reasoning: "OK" },
        { criterion: "dosage_accuracy", passed: true, reasoning: "OK" },
      ],
      overallPass: true,
      confidenceScore: 97,
      reasoning: "Fully compliant.",
    });

    const result = await engine.checkCompliance(
      "Calcium contributes to the maintenance of normal bones"
    );

    expect(result.decision).toBe("auto_send");
    expect(result.confidenceScore).toBeGreaterThanOrEqual(95);
  });

  it("should route <95% confidence to human_review", async () => {
    (mockJudge.evaluate as jest.Mock).mockResolvedValue({
      rubric: [
        { criterion: "faithfulness", passed: true, reasoning: "Borderline claim" },
        { criterion: "prohibited_terms", passed: true, reasoning: "OK" },
        { criterion: "dosage_accuracy", passed: true, reasoning: "OK" },
      ],
      overallPass: true,
      confidenceScore: 80,
      reasoning: "Claim is borderline — not clearly in the register.",
    });

    const result = await engine.checkCompliance(
      "This supplement helps your body in various ways"
    );

    expect(result.decision).toBe("human_review");
    expect(result.confidenceScore).toBeLessThan(95);
  });

  // ─── Error handling ───

  it("should route to human_review when judge model fails", async () => {
    (mockJudge.evaluate as jest.Mock).mockRejectedValue(
      new Error("API rate limited")
    );

    const result = await engine.checkCompliance(
      "Zinc contributes to normal cognitive function"
    );

    expect(result.decision).toBe("human_review");
    expect(result.confidenceScore).toBe(0);
    expect(result.triggeredRules).toContain("JUDGE_ERROR");
  });
});
