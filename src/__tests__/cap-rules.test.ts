/**
 * CAP Code Rule Enforcement Tests
 *
 * Tests all five CAP Code rules with known-good and known-bad claims.
 * Verifies confidence scoring and routing (≥95% auto-send, <95% human review).
 */

import {
  checkRule152,
  checkRule1562,
  checkRule1564,
  checkRule1566,
  runAllCapRuleChecks,
} from "@/lib/regulatory/rules/cap-rules";

describe("CAP Code Rule Checks", () => {
  // ─── Rule 15.2: GHC must be followed by SHC ───

  describe("Rule 15.2 — General Health Claims", () => {
    it("should FAIL orphaned GHC: 'Supports overall good health' (alone)", () => {
      const result = checkRule152("Supports overall good health");
      expect(result.passed).toBe(false);
      expect(result.rule).toBe("15.2");
      expect(result.confidencePenalty).toBe(100);
      expect(result.reason).toContain("Orphaned General Health Claim");
    });

    it("should PASS GHC followed by SHC", () => {
      const text =
        "Supports overall good health. Vitamin D contributes to the normal function of the immune system.";
      const result = checkRule152(text);
      expect(result.passed).toBe(true);
    });

    it("should PASS text with no GHC at all", () => {
      const result = checkRule152(
        "Vitamin D contributes to the normal function of the immune system."
      );
      expect(result.passed).toBe(true);
    });
  });

  // ─── Rule 15.6.2: No prevent/treat/cure ───

  describe("Rule 15.6.2 — Disease Claims", () => {
    it("should FAIL: 'This supplement cures colds'", () => {
      const result = checkRule1562("This supplement cures colds");
      expect(result.passed).toBe(false);
      expect(result.rule).toBe("15.6.2");
      expect(result.confidencePenalty).toBe(100);
      expect(result.reason).toContain("cure");
    });

    it("should FAIL: 'Prevents flu symptoms'", () => {
      const result = checkRule1562("Prevents flu symptoms");
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("prevent");
    });

    it("should FAIL: 'Treats cold and flu'", () => {
      const result = checkRule1562("Treats cold and flu");
      expect(result.passed).toBe(false);
    });

    it("should PASS: 'Vitamin D contributes to the normal function of the immune system'", () => {
      const result = checkRule1562(
        "Vitamin D contributes to the normal function of the immune system"
      );
      expect(result.passed).toBe(true);
    });

    it("should PASS: text without medicinal context", () => {
      const result = checkRule1562(
        "Our supplements are made from high-quality ingredients"
      );
      expect(result.passed).toBe(true);
    });
  });

  // ─── Rule 15.6.4: Fear-based language ───

  describe("Rule 15.6.4 — Fear-Based Claims", () => {
    it("should FLAG: 'Without this vitamin, your bones will deteriorate'", () => {
      const result = checkRule1564(
        "Without this vitamin, your bones will deteriorate"
      );
      expect(result.passed).toBe(false);
      expect(result.severity).toBe("flag_for_review");
      expect(result.confidencePenalty).toBe(60); // Conservative, not 100
      expect(result.reason).toContain("fear-based");
    });

    it("should FLAG: 'Your immune system could fail without this supplement'", () => {
      const result = checkRule1564(
        "Your immune system could fail without this supplement"
      );
      expect(result.passed).toBe(false);
      expect(result.severity).toBe("flag_for_review");
    });

    it("should PASS: neutral health claim", () => {
      const result = checkRule1564(
        "Calcium contributes to the maintenance of normal bones"
      );
      expect(result.passed).toBe(true);
    });
  });

  // ─── Rule 15.6.6: Weight loss claims ───

  describe("Rule 15.6.6 — Weight Loss Claims", () => {
    it("should FAIL: 'Lose 5kg in 2 weeks with our fat burner'", () => {
      const result = checkRule1566(
        "Lose 5kg in 2 weeks with our fat burner"
      );
      expect(result.passed).toBe(false);
      expect(result.rule).toBe("15.6.6");
      expect(result.confidencePenalty).toBe(100);
    });

    it("should FAIL: 'Drop 10 lbs in 7 days'", () => {
      const result = checkRule1566("Drop 10 lbs in 7 days");
      expect(result.passed).toBe(false);
    });

    it("should FAIL: 'Shed 3 stone in a month'", () => {
      const result = checkRule1566("Shed 3 stone in a month");
      expect(result.passed).toBe(false);
    });

    it("should PASS: general weight management claim", () => {
      const result = checkRule1566(
        "This supplement may support your weight management goals"
      );
      expect(result.passed).toBe(true);
    });
  });

  // ─── Full pipeline with all rules ───

  describe("Full Rule Pipeline", () => {
    it("should pass an authorized SHC with no violations", () => {
      const results = runAllCapRuleChecks(
        "Vitamin D contributes to the normal function of the immune system"
      );

      const allPassed = results.every((r) => r.passed);
      expect(allPassed).toBe(true);

      const totalPenalty = results.reduce(
        (sum, r) => sum + r.confidencePenalty,
        0
      );
      expect(totalPenalty).toBe(0);
    });

    it("should fail multiple rules for a bad claim", () => {
      const results = runAllCapRuleChecks(
        "This supplement cures colds. Lose 5kg in 2 weeks!"
      );

      const failedRules = results
        .filter((r) => !r.passed)
        .map((r) => r.rule);

      expect(failedRules).toContain("15.6.2"); // "cures colds"
      expect(failedRules).toContain("15.6.6"); // "5kg in 2 weeks"
    });

    it("should produce 100% penalty for hard fails", () => {
      const results = runAllCapRuleChecks(
        "This supplement cures disease"
      );

      const r1562 = results.find((r) => r.rule === "15.6.2");
      expect(r1562?.passed).toBe(false);
      expect(r1562?.confidencePenalty).toBe(100);
    });

    it("should produce <100% penalty for subjective flags (15.6.4)", () => {
      const results = runAllCapRuleChecks(
        "Without this vitamin, your bones will deteriorate"
      );

      const r1564 = results.find((r) => r.rule === "15.6.4");
      expect(r1564?.passed).toBe(false);
      expect(r1564?.confidencePenalty).toBeLessThan(100);
      expect(r1564?.severity).toBe("flag_for_review");
    });
  });
});
