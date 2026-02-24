import { RegulatoryChunk } from "./types";

/**
 * Critical ASA (Advertising Standards Authority) supplementary guidance
 * on health claims in food supplement advertising.
 */
const CRITICAL_ASA_GUIDANCE: Array<{
  section: string;
  title: string;
  text: string;
}> = [
  {
    section: "ASA-SUPP-1",
    title: "Substantiation of Health Claims",
    text:
      "All health claims in supplement advertising must be substantiated by " +
      "reference to the GB Nutrition and Health Claims Register. Advertisers " +
      "must hold documentary evidence showing that the product meets the " +
      "conditions of use associated with any claim made. The ASA will assess " +
      "claims against the register and may require the advertiser to provide " +
      "this evidence upon request. Unsubstantiated claims will be upheld as " +
      "misleading.",
  },
  {
    section: "ASA-SUPP-2",
    title: "Presentation of Mandatory Information",
    text:
      "Where a specific health claim is used, any conditions of use must be " +
      "clearly communicated. For example, if a claim about creatine requires " +
      "a daily intake of 3g, this condition must be prominently stated. " +
      "Conditions of use must not be hidden in footnotes or fine print if the " +
      "claim appears prominently in the main body of the advertisement.",
  },
  {
    section: "ASA-SUPP-3",
    title: "Social Media and Influencer Advertising",
    text:
      "Health claims made by influencers on behalf of supplement brands are " +
      "subject to the same advertising rules as any other marketing communication. " +
      "Brands are responsible for ensuring that influencers they engage do not " +
      "make unauthorized health claims, use prohibited terms, or present " +
      "supplements as medicinal products. Content briefs should specify approved " +
      "claim wording and explicitly prohibit improvised health claims. The " +
      "#ad disclosure requirement applies to all paid partnerships.",
  },
  {
    section: "ASA-SUPP-4",
    title: "Distinction Between Food Supplements and Medicinal Products",
    text:
      "Advertisements must not present food supplements as having the properties " +
      "of preventing, treating, or curing human disease. If the overall " +
      "impression of an advertisement suggests medicinal properties, it will be " +
      "assessed as a medicinal claim regardless of individual wording. The " +
      "context, imagery, and tone of the advertisement are considered alongside " +
      "the literal text.",
  },
  {
    section: "ASA-SUPP-5",
    title: "Testimonials and Endorsements for Supplements",
    text:
      "Testimonials and endorsements in supplement advertising must not include " +
      "unauthorized health claims. Personal experiences that imply therapeutic " +
      'effects (e.g. "This supplement cured my joint pain") are treated as ' +
      "health claims by the advertiser. Brands must vet all testimonials and " +
      "endorsement content to ensure compliance with the CAP Code and GB NHC " +
      "Register.",
  },
  {
    section: "ASA-SUPP-6",
    title: "Vulnerable Audiences and Targeting",
    text:
      "Particular care must be taken when supplement advertising could be seen " +
      "by or is targeted at vulnerable audiences, including people with chronic " +
      "health conditions, the elderly, or those seeking alternatives to medical " +
      "treatment. Advertising must not exploit the vulnerability, credulity, or " +
      "lack of knowledge of these audiences. Fear-based messaging is especially " +
      "problematic when directed at vulnerable groups.",
  },
];

/**
 * Scrapes / returns the critical ASA supplementary guidance on health claims
 * in supplement advertising. In production, this would fetch from the ASA website.
 */
export async function scrapeAsaGuidance(): Promise<RegulatoryChunk[]> {
  const now = new Date();

  return CRITICAL_ASA_GUIDANCE.map((guidance) => ({
    text: `${guidance.title}: ${guidance.text}`,
    sourceAuthority: "ASA" as const,
    ruleNumber: guidance.section,
    sectionTitle: guidance.title,
    lastAccessed: now,
  }));
}

/** Exported for use in other modules. */
export { CRITICAL_ASA_GUIDANCE };
