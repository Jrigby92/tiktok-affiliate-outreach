import * as cheerio from "cheerio";
import { RegulatoryChunk } from "./types";

/**
 * Critical authorized health claims from the GB Nutrition and Health Claims Register.
 * These are the most commonly referenced claims for supplement marketing in the UK.
 * The full register is maintained by the MHRA / Food Standards Agency.
 */
const CRITICAL_NHC_CLAIMS: Array<{ claim: string; nutrient: string; conditions?: string }> = [
  {
    nutrient: "Vitamin D",
    claim:
      "Vitamin D contributes to the normal function of the immune system",
  },
  {
    nutrient: "Vitamin C",
    claim:
      "Vitamin C contributes to the reduction of tiredness and fatigue",
  },
  {
    nutrient: "Calcium",
    claim: "Calcium is needed for the maintenance of normal bones",
  },
  {
    nutrient: "Zinc",
    claim:
      "Zinc contributes to the normal function of the immune system",
  },
  {
    nutrient: "Iron",
    claim: "Iron contributes to normal cognitive function",
  },
  {
    nutrient: "Creatine",
    claim:
      "Creatine increases physical performance in successive bursts of short-term, high intensity exercise. The beneficial effect is obtained with a daily intake of 3g of creatine.",
    conditions: "Daily intake of 3g",
  },
  {
    nutrient: "Vitamin B6",
    claim:
      "Vitamin B6 contributes to the normal function of the nervous system",
  },
  {
    nutrient: "Magnesium",
    claim:
      "Magnesium contributes to a reduction of tiredness and fatigue",
  },
  {
    nutrient: "Omega-3 (DHA)",
    claim:
      "DHA contributes to the maintenance of normal brain function",
    conditions: "Daily intake of 250mg DHA",
  },
  {
    nutrient: "Biotin",
    claim:
      "Biotin contributes to the maintenance of normal hair",
  },
  {
    nutrient: "Vitamin B12",
    claim:
      "Vitamin B12 contributes to normal energy-yielding metabolism",
  },
  {
    nutrient: "Selenium",
    claim:
      "Selenium contributes to the normal function of the immune system",
  },
];

const GB_NHC_REGISTER_URL =
  "https://www.gov.uk/government/publications/nutrition-and-health-claims-register";

/**
 * Scrapes the GB Nutrition and Health Claims Register.
 * Falls back to hardcoded critical claims if the live fetch fails.
 */
export async function scrapeGbNhcRegister(): Promise<RegulatoryChunk[]> {
  const now = new Date();
  const chunks: RegulatoryChunk[] = [];

  // Attempt to fetch and parse the live register
  try {
    const response = await fetch(GB_NHC_REGISTER_URL);
    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);

      // Parse claim entries from the HTML structure
      $("table tbody tr").each((_index, element) => {
        const cells = $(element).find("td");
        if (cells.length >= 2) {
          const claimText = $(cells[1]).text().trim();
          if (claimText && claimText.length > 10) {
            chunks.push({
              text: claimText,
              sourceAuthority: "MHRA",
              ruleNumber: "GB NHC Register",
              sectionTitle: "Authorized Health Claim",
              lastAccessed: now,
            });
          }
        }
      });
    }
  } catch {
    // Live fetch failed — fall through to hardcoded claims
  }

  // Always include the critical hardcoded claims to ensure coverage
  for (const entry of CRITICAL_NHC_CLAIMS) {
    const text = entry.conditions
      ? `${entry.claim} [Conditions of use: ${entry.conditions}]`
      : entry.claim;

    // Avoid duplicates if the live scrape already captured this claim
    const alreadyPresent = chunks.some(
      (c) => c.text.includes(entry.nutrient) && c.text.includes(entry.claim.slice(0, 40))
    );

    if (!alreadyPresent) {
      chunks.push({
        text,
        sourceAuthority: "MHRA",
        ruleNumber: "GB NHC Register",
        sectionTitle: `Authorized Health Claim — ${entry.nutrient}`,
        lastAccessed: now,
      });
    }
  }

  return chunks;
}

/** Exported for use in rule checks — the raw list of authorized claims. */
export { CRITICAL_NHC_CLAIMS };
