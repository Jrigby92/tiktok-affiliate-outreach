/**
 * 4-Step Content Brief Synthesizer
 *
 * 1. TREND MATCH     → Find a relevant viral hook
 * 2. PRODUCT ALIGNMENT → Map the hook to an Andinn Organics product
 * 3. REGULATORY CHECK  → Call Section 3 RAG engine. Insert mandatory SHCs. Strip medicinal claims.
 * 4. CREATIVE GUARDS   → Suggest transitions, approved hashtags, trending audio (business-approved only)
 *
 * Output: ready-to-shoot content brief with regulatory annotations visible.
 * ALL LLM calls go through the Dynamic LLM Router.
 */

import { DynamicLLMRouter } from "@/lib/llm/router";
import { ComplianceEngine } from "@/lib/regulatory/compliance/engine";
import {
  StoredTrend,
  TrendingHashtag,
  TrendingSound,
  ViralVideo,
} from "@/lib/trends/types";
import { ProductCatalogEntry } from "@/lib/creators/types";
import {
  ContentBrief,
  TrendMatchResult,
  ProductAlignmentResult,
  RegulatoryCheckResult,
  CreativeGuardsResult,
} from "./types";

export class ContentBriefSynthesizer {
  private router: DynamicLLMRouter;
  private complianceEngine: ComplianceEngine;

  constructor(
    router: DynamicLLMRouter,
    complianceEngine: ComplianceEngine
  ) {
    this.router = router;
    this.complianceEngine = complianceEngine;
  }

  /**
   * Generate a complete content brief from a trend and product catalog.
   * Executes all 4 steps in sequence.
   */
  async synthesize(
    trend: StoredTrend,
    products: ProductCatalogEntry[],
    trendingSounds?: TrendingSound[]
  ): Promise<ContentBrief> {
    const briefId = `brief_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

    // Step 1: Trend Match
    const trendMatch = await this.matchTrend(trend);

    // Step 2: Product Alignment
    const productAlignment = await this.alignProduct(
      trendMatch,
      products
    );

    // Step 3: Regulatory Check
    const regulatoryCheck = await this.checkRegulatory(
      productAlignment
    );

    // Step 4: Creative Guards
    const creativeGuards = await this.applyCreativeGuards(
      trendMatch,
      productAlignment,
      regulatoryCheck,
      trendingSounds
    );

    // Assemble final brief text
    const briefText = await this.assembleBrief(
      trendMatch,
      productAlignment,
      regulatoryCheck,
      creativeGuards
    );

    return {
      briefId,
      trendMatch,
      productAlignment,
      regulatoryCheck,
      creativeGuards,
      briefText,
      approvalStatus: regulatoryCheck.passed
        ? "pending_approval"
        : "pending_generation",
      targetCreatorIds: [],
      createdAt: new Date(),
    };
  }

  /**
   * Step 1: TREND MATCH — Identify a viral hook from the trend.
   */
  async matchTrend(trend: StoredTrend): Promise<TrendMatchResult> {
    const trendDescription = this.describeTrend(trend);

    const result = await this.router.call({
      taskType: "content_brief_generation",
      systemPrompt: `You are a TikTok content strategist specializing in UK health and wellness.
Analyze the given trend data and identify the viral hook pattern.

Respond in JSON:
{
  "viralHook": "Name of the hook pattern (e.g., 'Day in the Life', 'Morning Routine', 'What I Eat in a Day')",
  "hookCategory": "Category (e.g., 'lifestyle', 'transformation', 'educational', 'challenge', 'GRWM')",
  "relevanceScore": 0-100
}`,
      userMessage: `Trend data:\n${trendDescription}`,
      maxTokens: 512,
      temperature: 0.3,
    });

    const parsed = this.parseJSON(result.text, {
      viralHook: "Trending content hook",
      hookCategory: "lifestyle",
      relevanceScore: 50,
    });

    return {
      trend,
      viralHook: parsed.viralHook,
      hookCategory: parsed.hookCategory,
      relevanceScore: Math.min(100, Math.max(0, parsed.relevanceScore)),
    };
  }

  /**
   * Step 2: PRODUCT ALIGNMENT — Map the hook to a specific product.
   */
  async alignProduct(
    trendMatch: TrendMatchResult,
    products: ProductCatalogEntry[]
  ): Promise<ProductAlignmentResult> {
    const productList = products
      .map(
        (p) =>
          `- ${p.name} (${p.productId}): category=${p.category}, tags=${p.nicheTags.join(", ")}`
      )
      .join("\n");

    const result = await this.router.call({
      taskType: "content_brief_generation",
      systemPrompt: `You are a product marketing specialist for Andinn Organics, a UK health supplement brand.
Given a viral TikTok hook and product catalog, select the BEST product match and explain the alignment.

IMPORTANT: Only suggest health benefits that are factual and general. Do NOT make specific health claims.

Respond in JSON:
{
  "productId": "selected product ID",
  "productName": "product name",
  "alignmentReason": "why this product fits the hook",
  "alignmentScore": 0-100,
  "keyBenefits": ["benefit 1", "benefit 2", "benefit 3"]
}`,
      userMessage: `Viral hook: "${trendMatch.viralHook}" (category: ${trendMatch.hookCategory})

Product catalog:
${productList}`,
      maxTokens: 512,
      temperature: 0.3,
    });

    const fallbackProduct = products[0] || {
      productId: "unknown",
      name: "Unknown Product",
    };

    const parsed = this.parseJSON(result.text, {
      productId: fallbackProduct.productId,
      productName: fallbackProduct.name,
      alignmentReason: "General health and wellness alignment",
      alignmentScore: 50,
      keyBenefits: [],
    });

    return {
      productId: parsed.productId,
      productName: parsed.productName,
      alignmentReason: parsed.alignmentReason,
      alignmentScore: Math.min(100, Math.max(0, parsed.alignmentScore)),
      keyBenefits: parsed.keyBenefits,
    };
  }

  /**
   * Step 3: REGULATORY CHECK — Run through Section 3 RAG engine.
   */
  async checkRegulatory(
    productAlignment: ProductAlignmentResult
  ): Promise<RegulatoryCheckResult> {
    // Combine all claims to check
    const claimsToCheck = [
      ...productAlignment.keyBenefits,
      productAlignment.alignmentReason,
    ];

    let overallPassed = true;
    const authorizedClaims: string[] = [];
    const mandatorySHCs: string[] = [];
    const strippedTerms: string[] = [];
    let lastComplianceResult = null;

    for (const claim of claimsToCheck) {
      const result = await this.complianceEngine.checkCompliance(claim);
      lastComplianceResult = result;

      if (result.decision === "auto_send") {
        authorizedClaims.push(claim);
      } else {
        overallPassed = false;
        // Extract stripped terms from triggered rules
        for (const rule of result.triggeredRules) {
          if (rule === "15.6.2" || rule === "JUDGE_PROHIBITED_TERMS") {
            strippedTerms.push(claim);
          }
        }
      }

      // Extract mandatory SHCs from retrieved chunks
      for (const chunk of result.retrievedChunks) {
        if (
          chunk.sourceAuthority === "MHRA" &&
          chunk.regulationText.includes("contributes to")
        ) {
          mandatorySHCs.push(chunk.regulationText);
        }
      }
    }

    return {
      complianceResult: lastComplianceResult || {
        claim: "",
        confidenceScore: 0,
        decision: "human_review",
        ruleChecks: [],
        judgeVerdict: null,
        retrievedChunks: [],
        triggeredRules: [],
        summary: "No claims to check",
      },
      authorizedClaims,
      mandatorySHCs: Array.from(new Set(mandatorySHCs)),
      strippedTerms,
      passed: overallPassed,
    };
  }

  /**
   * Step 4: CREATIVE GUARDS — Suggest transitions, hashtags, audio.
   */
  async applyCreativeGuards(
    trendMatch: TrendMatchResult,
    productAlignment: ProductAlignmentResult,
    regulatoryCheck: RegulatoryCheckResult,
    trendingSounds?: TrendingSound[]
  ): Promise<CreativeGuardsResult> {
    // Only suggest business-approved sounds
    const approvedSounds = (trendingSounds || []).filter(
      (s) => s.isBusinessApproved
    );

    const result = await this.router.call({
      taskType: "content_brief_generation",
      systemPrompt: `You are a TikTok creative director for a UK health supplement brand.
Suggest creative elements for a content brief. Only suggest elements that are appropriate
for health supplement marketing in the UK.

Respond in JSON:
{
  "suggestedTransitions": ["transition 1", "transition 2", "transition 3"],
  "approvedHashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"],
  "contentStructure": ["step 1", "step 2", "step 3", "step 4"]
}`,
      userMessage: `Hook: "${trendMatch.viralHook}"
Product: ${productAlignment.productName}
Authorized claims: ${regulatoryCheck.authorizedClaims.join("; ") || "None specific"}
Category: ${trendMatch.hookCategory}`,
      maxTokens: 512,
      temperature: 0.5,
    });

    const parsed = this.parseJSON(result.text, {
      suggestedTransitions: ["Cut to product", "Reveal shot", "Before/after"],
      approvedHashtags: [
        productAlignment.productName.toLowerCase().replace(/\s+/g, ""),
        "wellness",
        "healthtok",
        "supplementsuk",
        "fyp",
      ],
      contentStructure: [
        "Hook: grab attention",
        "Context: show the routine",
        "Product: natural integration",
        "CTA: encourage engagement",
      ],
    });

    // Select trending audio (business-approved only)
    const trendingAudio =
      approvedSounds.length > 0
        ? {
            soundId: approvedSounds[0].soundId,
            title: approvedSounds[0].title,
            artist: approvedSounds[0].artist,
          }
        : undefined;

    return {
      suggestedTransitions: parsed.suggestedTransitions,
      approvedHashtags: parsed.approvedHashtags,
      trendingAudio,
      contentStructure: parsed.contentStructure,
    };
  }

  /**
   * Assemble the final brief text from all 4 steps.
   */
  private async assembleBrief(
    trendMatch: TrendMatchResult,
    productAlignment: ProductAlignmentResult,
    regulatoryCheck: RegulatoryCheckResult,
    creativeGuards: CreativeGuardsResult
  ): Promise<string> {
    const result = await this.router.call({
      taskType: "outreach_messaging",
      systemPrompt: `You are writing a content brief for a TikTok creator promoting a UK health supplement.
The brief must be:
- Friendly and conversational
- Clear about the content hook and product placement
- Include ONLY authorized health claims (provided below)
- NEVER use "cure", "treat", or "prevent" in relation to health conditions
- Include mandatory specific health claims (SHCs) where required

Write a concise, actionable brief that a creator can use to shoot a video.`,
      userMessage: `HOOK: ${trendMatch.viralHook} (${trendMatch.hookCategory})

PRODUCT: ${productAlignment.productName}
WHY THIS PRODUCT: ${productAlignment.alignmentReason}
KEY BENEFITS: ${productAlignment.keyBenefits.join(", ")}

AUTHORIZED CLAIMS (use these exact phrases):
${regulatoryCheck.authorizedClaims.map((c) => `- "${c}"`).join("\n") || "- No specific claims authorized (keep it general)"}

MANDATORY SHCs TO INCLUDE:
${regulatoryCheck.mandatorySHCs.map((s) => `- "${s}"`).join("\n") || "- None required"}

CONTENT STRUCTURE:
${creativeGuards.contentStructure.map((s, i) => `${i + 1}. ${s}`).join("\n")}

TRANSITIONS: ${creativeGuards.suggestedTransitions.join(", ")}
HASHTAGS: ${creativeGuards.approvedHashtags.map((h) => `#${h}`).join(" ")}
${creativeGuards.trendingAudio ? `AUDIO: "${creativeGuards.trendingAudio.title}" by ${creativeGuards.trendingAudio.artist || "Unknown"}` : ""}

Write the brief now.`,
      maxTokens: 1024,
      temperature: 0.6,
    });

    return result.text;
  }

  // ─── Helpers ───

  private describeTrend(trend: StoredTrend): string {
    const data = trend.data;

    switch (trend.streamType) {
      case "hashtags": {
        const h = data as TrendingHashtag;
        return `Type: Trending hashtag\nHashtag: #${h.hashtag}\nRank: ${h.rank}\nRegion: ${h.region}\nIndustry: ${h.industryTag}\nViews: ${h.viewCount.toLocaleString()}`;
      }
      case "viral_videos": {
        const v = data as ViralVideo;
        return `Type: Viral video\nCreator: @${v.creatorHandle}\nLikes: ${v.likes.toLocaleString()}\nShares: ${v.shares.toLocaleString()}\nComments: ${v.comments.toLocaleString()}\nTranscript: ${v.transcriptSummary}\nHashtags: ${v.hashtags.join(", ")}`;
      }
      case "music_sounds": {
        const s = data as TrendingSound;
        return `Type: Trending sound\nTitle: ${s.title}\nArtist: ${s.artist || "Unknown"}\nUsage: ${s.usageCount.toLocaleString()} videos\nGrowth: ${s.growthRate}%\nBusiness approved: ${s.isBusinessApproved}`;
      }
      default:
        return `Type: ${trend.streamType}\nData: ${JSON.stringify(data)}`;
    }
  }

  private parseJSON<T extends Record<string, unknown>>(
    text: string,
    defaults: T
  ): T {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { ...defaults, ...JSON.parse(jsonMatch[0]) };
      }
    } catch {
      // Fall through to defaults
    }
    return defaults;
  }
}
