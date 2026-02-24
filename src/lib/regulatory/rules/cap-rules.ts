/**
 * CAP Code Rule Enforcement
 *
 * Hardcoded detection for five specific CAP Code rules.
 * These run as deterministic checks BEFORE the LLM judge.
 */

export interface RuleCheckResult {
  rule: string;
  passed: boolean;
  severity: "fail" | "flag_for_review";
  reason: string;
  /** Confidence penalty (0–100) — subtracted from base confidence */
  confidencePenalty: number;
}

// ─── Banned words in medicinal context ───
const BANNED_MEDICINAL_WORDS = ["cure", "cures", "curing", "treat", "treats", "treating", "treatment", "prevent", "prevents", "preventing", "prevention"];
const DISEASE_CONTEXT_WORDS = ["disease", "illness", "infection", "condition", "disorder", "syndrome", "cancer", "diabetes", "cold", "flu", "virus", "bacteria"];

// ─── Weight loss patterns ───
const WEIGHT_LOSS_PATTERN = /(?:lose|shed|drop|burn|melt)\s+(?:\d+\s*(?:kg|lbs?|pounds?|stone|kilos?))/i;
const WEIGHT_RATE_PATTERN = /(?:\d+\s*(?:kg|lbs?|pounds?|stone|kilos?)\s+(?:in|per|within|every)\s+\d+\s*(?:days?|weeks?|months?))/i;

// ─── Fear-based language indicators ───
const FEAR_PATTERNS = [
  /without\s+(?:this|these|the)\s+\w+.*(?:will|could|may|might)\s+(?:deteriorate|degrade|decline|worsen|suffer|fail|break|weaken)/i,
  /(?:your|the)\s+(?:bones?|muscles?|joints?|organs?|body|health|immune\s+system).*(?:will|could|may|might)\s+(?:deteriorate|fail|weaken|break\s+down|stop\s+working)/i,
  /risk\s+of\s+(?:serious|severe|permanent|irreversible)/i,
  /(?:danger|dangerous|harmful|damaging)\s+(?:if|when|without)/i,
];

// ─── General Health Claim indicators ───
const GHC_PATTERNS = [
  /supports?\s+(?:overall\s+)?(?:general\s+)?(?:good\s+)?health/i,
  /good\s+for\s+(?:your|the)\s+(?:body|health|wellbeing|well-being)/i,
  /(?:promotes?|maintains?|contributes?\s+to)\s+(?:overall|general)\s+(?:health|wellbeing|well-being)/i,
  /(?:healthy|healthier)\s+(?:lifestyle|living|body)/i,
];

/**
 * Rule 15.1.1 — Only claims from GB NHC Register allowed.
 * This rule requires cross-referencing against the register,
 * so it delegates to the judge model for final verification.
 * Here we do a preliminary check.
 */
export function checkRule1511(
  text: string,
  authorizedClaims: string[] = []
): RuleCheckResult {
  // The full cross-reference check is done by the judge model
  // with access to retrieved RAG chunks. This is a preliminary flag.
  const hasHealthClaim =
    /(?:contributes?\s+to|supports?|helps?|maintains?|aids?)\s+(?:the\s+)?(?:normal\s+)?(?:function|maintenance|health|growth|development)/i.test(
      text
    );

  if (hasHealthClaim) {
    return {
      rule: "15.1.1",
      passed: true, // Preliminary pass — judge model verifies against register
      severity: "fail",
      reason: "Health claim detected — requires verification against GB NHC Register (delegated to judge model)",
      confidencePenalty: 0,
    };
  }

  return {
    rule: "15.1.1",
    passed: true,
    severity: "fail",
    reason: "No health claim detected",
    confidencePenalty: 0,
  };
}

/**
 * Rule 15.2 — GHC must be immediately followed by authorized SHC.
 * Detects orphaned general health claims.
 */
export function checkRule152(text: string): RuleCheckResult {
  for (const pattern of GHC_PATTERNS) {
    if (pattern.test(text)) {
      // Check if a specific authorized claim follows
      const hasSpecificClaim =
        /(?:contributes?\s+to\s+the\s+normal\s+function|contributes?\s+to\s+the\s+maintenance|contributes?\s+to\s+normal\s+\w+\s+function)/i.test(
          text
        );

      if (!hasSpecificClaim) {
        return {
          rule: "15.2",
          passed: false,
          severity: "fail",
          reason: "Orphaned General Health Claim detected without an accompanying authorized Specific Health Claim",
          confidencePenalty: 100,
        };
      }
    }
  }

  return {
    rule: "15.2",
    passed: true,
    severity: "fail",
    reason: "No orphaned GHC detected",
    confidencePenalty: 0,
  };
}

/**
 * Rule 15.6.2 — No claims to prevent, treat, or cure disease.
 * Zero tolerance.
 */
export function checkRule1562(text: string): RuleCheckResult {
  const lowerText = text.toLowerCase();

  for (const banned of BANNED_MEDICINAL_WORDS) {
    if (lowerText.includes(banned)) {
      // Check if it's in a medicinal context
      const hasDiseaseContext = DISEASE_CONTEXT_WORDS.some((word) =>
        lowerText.includes(word)
      );

      // Also check proximity: banned word near health/body references
      const inMedicinalContext =
        hasDiseaseContext ||
        /(?:cure|treat|prevent)s?\s+(?:\w+\s+){0,3}(?:symptoms?|signs?|effects?|problems?)/i.test(
          text
        );

      if (inMedicinalContext) {
        return {
          rule: "15.6.2",
          passed: false,
          severity: "fail",
          reason: `Medicinal claim detected: "${banned}" used in disease/health context. Supplements cannot claim to prevent, treat, or cure disease.`,
          confidencePenalty: 100,
        };
      }
    }
  }

  return {
    rule: "15.6.2",
    passed: true,
    severity: "fail",
    reason: "No prohibited medicinal claims detected",
    confidencePenalty: 0,
  };
}

/**
 * Rule 15.6.4 — No fear-based references to bodily functions.
 * This is subjective — flag for human review when uncertain.
 */
export function checkRule1564(text: string): RuleCheckResult {
  for (const pattern of FEAR_PATTERNS) {
    if (pattern.test(text)) {
      return {
        rule: "15.6.4",
        passed: false,
        severity: "flag_for_review",
        reason: "Potential fear-based language detected referencing bodily functions. This is subjective — routed to human review.",
        confidencePenalty: 60, // Conservative — triggers human review
      };
    }
  }

  return {
    rule: "15.6.4",
    passed: true,
    severity: "flag_for_review",
    reason: "No fear-based language detected",
    confidencePenalty: 0,
  };
}

/**
 * Rule 15.6.6 — No specific rate or amount of weight loss.
 */
export function checkRule1566(text: string): RuleCheckResult {
  if (WEIGHT_LOSS_PATTERN.test(text) || WEIGHT_RATE_PATTERN.test(text)) {
    return {
      rule: "15.6.6",
      passed: false,
      severity: "fail",
      reason: "Specific weight loss rate or amount detected. Claims about specific weight loss figures are prohibited.",
      confidencePenalty: 100,
    };
  }

  return {
    rule: "15.6.6",
    passed: true,
    severity: "fail",
    reason: "No specific weight loss claims detected",
    confidencePenalty: 0,
  };
}

/**
 * Run all five CAP Code rule checks on a piece of text.
 */
export function runAllCapRuleChecks(text: string): RuleCheckResult[] {
  return [
    checkRule1511(text),
    checkRule152(text),
    checkRule1562(text),
    checkRule1564(text),
    checkRule1566(text),
  ];
}
