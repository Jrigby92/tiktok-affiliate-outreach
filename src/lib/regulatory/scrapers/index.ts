export { type RegulatoryChunk } from "./types";
export { scrapeGbNhcRegister, CRITICAL_NHC_CLAIMS } from "./gb-nhc-register";
export { scrapeCapCode, CRITICAL_CAP_RULES } from "./cap-code";
export { scrapeAsaGuidance, CRITICAL_ASA_GUIDANCE } from "./asa-guidance";

import { scrapeGbNhcRegister } from "./gb-nhc-register";
import { scrapeCapCode } from "./cap-code";
import { scrapeAsaGuidance } from "./asa-guidance";
import { RegulatoryChunk } from "./types";

/**
 * Fetches all critical regulatory chunks from all three knowledge bases.
 * Combines GB NHC Register, CAP Code Section 15, and ASA supplementary guidance.
 */
export async function getAllCriticalChunks(): Promise<RegulatoryChunk[]> {
  const [nhcChunks, capChunks, asaChunks] = await Promise.all([
    scrapeGbNhcRegister(),
    scrapeCapCode(),
    scrapeAsaGuidance(),
  ]);

  return [...nhcChunks, ...capChunks, ...asaChunks];
}
