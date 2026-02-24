import { RegulatoryChunk } from "./types";

/**
 * Critical CAP Code rules from Section 15 — Food, food supplements,
 * and associated health or nutrition claims.
 *
 * These are the five rules the compliance engine must enforce.
 */
const CRITICAL_CAP_RULES: Array<{
  rule: string;
  title: string;
  text: string;
}> = [
  {
    rule: "15.1.1",
    title: "Only Authorized Claims Permitted",
    text:
      "Marketing communications that contain nutrition or health claims must be " +
      "supported by documentary evidence to show they meet the conditions of use " +
      "associated with the relevant claim, as specified in the GB Nutrition and " +
      "Health Claims Register. Only health claims listed in the register may be " +
      "used in marketing communications for food and food supplements. Claims not " +
      "appearing in the register are prohibited.",
  },
  {
    rule: "15.2",
    title: "General Health Claims Must Be Accompanied by Specific Claims",
    text:
      "A general health claim may only be made if it is accompanied by a related " +
      "authorized specific health claim from the GB NHC Register. A general health " +
      'claim (e.g. "Supports overall good health" or "Good for your wellbeing") ' +
      "must be immediately followed by an authorized specific health claim that " +
      "relates to the general claim. An orphaned general health claim — one not " +
      "accompanied by a specific authorized claim — is not permitted.",
  },
  {
    rule: "15.6.2",
    title: "No Claims to Prevent, Treat, or Cure Disease",
    text:
      "Marketing communications must not claim that a food or food supplement can " +
      "prevent, treat, or cure human disease. This includes explicit claims " +
      '(e.g. "cures colds", "prevents cancer", "treats arthritis") and implied ' +
      "claims that suggest therapeutic or medicinal properties. The prohibition " +
      'covers the words "cure", "treat", "prevent", "remedy", "heal" and any ' +
      "synonyms when used in relation to human disease or medical conditions.",
  },
  {
    rule: "15.6.4",
    title: "No Exploitation of Fear Regarding Bodily Functions",
    text:
      "Marketing communications must not make reference to the functions of the " +
      "body in a way that could cause fear or distress. This includes claims that " +
      "exploit anxiety about the consequences of not consuming a product " +
      '(e.g. "Without this vitamin, your bones will deteriorate", "Your immune ' +
      'system will fail without daily supplementation"). Negative framing of ' +
      "health outcomes to pressure consumers into purchasing is prohibited. The " +
      "assessment of whether language exploits fear is inherently subjective and " +
      "should be conservatively evaluated.",
  },
  {
    rule: "15.6.6",
    title: "No Specific Weight Loss Claims",
    text:
      "Marketing communications must not contain any claim about the rate or " +
      "amount of weight loss that may be achieved by using a food or food " +
      'supplement. This includes claims such as "Lose 5kg in 2 weeks", ' +
      '"Burn 10 pounds of fat", or "Drop 2 dress sizes in a month". General ' +
      'weight management claims (e.g. "may contribute to weight management ' +
      'as part of a calorie-controlled diet") may be permissible if supported ' +
      "by an authorized health claim, but specific rates or amounts are always " +
      "prohibited.",
  },
];

/**
 * Scrapes / returns the critical CAP Code Section 15 rules.
 * In production, this would fetch the live CAP Code from the ASA/CAP website.
 * The hardcoded rules ensure the five critical enforcement rules are always available.
 */
export async function scrapeCapCode(): Promise<RegulatoryChunk[]> {
  const now = new Date();

  return CRITICAL_CAP_RULES.map((rule) => ({
    text: `Rule ${rule.rule} — ${rule.title}: ${rule.text}`,
    sourceAuthority: "CAP" as const,
    ruleNumber: rule.rule,
    sectionTitle: `Section 15 — ${rule.title}`,
    lastAccessed: now,
  }));
}

/** Exported for use in rule checks. */
export { CRITICAL_CAP_RULES };
