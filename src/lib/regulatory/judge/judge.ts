/**
 * Judge Model — Claude 4.5 Haiku
 *
 * Secondary verification layer that evaluates the primary model's output
 * against retrieved regulatory chunks using a structured 3-point rubric:
 *
 * 1. Faithfulness — claim stays within authorized bounds?
 * 2. Prohibited Terms — contains "cure"/"treat"/"prevent"?
 * 3. Dosage Accuracy — dosage matches register conditions?
 */

import Anthropic from "@anthropic-ai/sdk";
import { RetrievedChunk } from "../rag/retrieval";

export interface JudgeRubricPoint {
  criterion: "faithfulness" | "prohibited_terms" | "dosage_accuracy";
  passed: boolean;
  reasoning: string;
}

export interface JudgeVerdict {
  rubric: JudgeRubricPoint[];
  overallPass: boolean;
  confidenceScore: number;
  reasoning: string;
}

const JUDGE_MODEL = "claude-haiku-4-5-20251001";

const JUDGE_SYSTEM_PROMPT = `You are a regulatory compliance judge for UK food supplement marketing.
You evaluate marketing claims against the GB Nutrition and Health Claims (GB NHC) Register
and the CAP Code.

You MUST evaluate each claim using this exact 3-point rubric:

1. FAITHFULNESS: Does the generated claim stay within the bounds of an authorized health claim
   in the GB NHC Register? Any claim not found in the register = FAIL.

2. PROHIBITED TERMS: Does the output contain "cure," "treat," or "prevent" when referring to
   human disease? Any occurrence = FAIL.

3. DOSAGE ACCURACY: If a dosage is mentioned (e.g., "3g of creatine"), is it consistent with
   the register's conditions of use? Inaccurate dosage = FAIL.

Respond ONLY with valid JSON matching this schema:
{
  "rubric": [
    {"criterion": "faithfulness", "passed": true/false, "reasoning": "..."},
    {"criterion": "prohibited_terms", "passed": true/false, "reasoning": "..."},
    {"criterion": "dosage_accuracy", "passed": true/false, "reasoning": "..."}
  ],
  "overallPass": true/false,
  "confidenceScore": 0-100,
  "reasoning": "Brief overall assessment"
}`;

export class ComplianceJudge {
  private client: Anthropic;

  constructor(client: Anthropic) {
    this.client = client;
  }

  /**
   * Evaluate a marketing claim against retrieved regulatory context.
   */
  async evaluate(
    claim: string,
    retrievedChunks: RetrievedChunk[]
  ): Promise<JudgeVerdict> {
    const context = retrievedChunks
      .map(
        (chunk, i) =>
          `[${i + 1}] (${chunk.sourceAuthority} — ${chunk.ruleNumber}, similarity: ${chunk.similarityScore.toFixed(3)})\n${chunk.regulationText}`
      )
      .join("\n\n");

    const response = await this.client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 1024,
      system: JUDGE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `CLAIM TO EVALUATE:\n"${claim}"\n\nRETRIEVED REGULATORY CONTEXT:\n${context}\n\nEvaluate this claim against the 3-point rubric. Respond with JSON only.`,
        },
      ],
    });

    // Extract text content from the response
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Judge model returned no text content");
    }

    // Parse JSON response
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Judge model returned invalid JSON");
    }

    const verdict = JSON.parse(jsonMatch[0]) as JudgeVerdict;

    // Ensure overallPass is consistent with rubric
    verdict.overallPass = verdict.rubric.every((r) => r.passed);

    return verdict;
  }
}
