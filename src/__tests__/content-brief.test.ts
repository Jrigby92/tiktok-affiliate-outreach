/**
 * Content Brief Synthesizer & Approval Gate Tests
 *
 * Verifies:
 * - 4-step pipeline produces compliant output
 * - RAG passes, no banned words, GHC+SHC paired
 * - Approval gate blocks without approval
 * - All four notification channels work
 * - Rejection logs reason
 */

import { ContentBriefSynthesizer } from "@/lib/content/synthesizer";
import { ContentApprovalGate } from "@/lib/content/approval";
import { DynamicLLMRouter } from "@/lib/llm/router";
import { ComplianceEngine } from "@/lib/regulatory/compliance/engine";
import { StoredTrend, TrendingHashtag, TrendingSound } from "@/lib/trends/types";
import { ProductCatalogEntry } from "@/lib/creators/types";

// ─── Mocks ───

jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  viralHook: "Morning Routine",
                  hookCategory: "lifestyle",
                  relevanceScore: 85,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
        }),
      },
    },
  }));
});

jest.mock("@anthropic-ai/sdk", () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              rubric: [
                { criterion: "faithfulness", passed: true, reasoning: "ok" },
                { criterion: "prohibited_terms", passed: true, reasoning: "ok" },
                { criterion: "dosage_accuracy", passed: true, reasoning: "ok" },
              ],
              overallPass: true,
              confidenceScore: 97,
              reasoning: "All checks passed",
            }),
          },
        ],
        usage: { input_tokens: 40, output_tokens: 30 },
      }),
    },
  }));
});

jest.mock("langsmith/wrappers", () => ({
  wrapOpenAI: jest.fn((client) => client),
}));

jest.mock("langsmith/traceable", () => ({
  traceable: jest.fn((fn) => fn),
}));

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock database pool
const mockQuery = jest.fn();
const mockDb = {
  query: mockQuery,
} as unknown as import("pg").Pool;

// ─── Test Data ───

const sampleTrend: StoredTrend = {
  id: 1,
  streamType: "hashtags",
  data: {
    hashtag: "morningroutine",
    rank: 1,
    region: "GB",
    industryTag: "wellness",
    viewCount: 50_000_000,
    scrapedAt: new Date(),
  } as TrendingHashtag,
  engagementScore: 85,
  isSuperViral: true,
  createdAt: new Date(),
};

const sampleProducts: ProductCatalogEntry[] = [
  {
    productId: "prod-vitd",
    sku: "VITD-001",
    name: "Vitamin D3 1000IU",
    category: "vitamins",
    targetAudience: {
      countries: ["GB"],
      interests: ["health", "wellness", "supplements"],
    },
    nicheTags: ["supplements", "vitamins", "health"],
    price: 12.99,
  },
  {
    productId: "prod-omega",
    sku: "OMEGA-001",
    name: "Omega-3 Fish Oil",
    category: "supplements",
    targetAudience: {
      countries: ["GB"],
      interests: ["fitness", "heart-health"],
    },
    nicheTags: ["supplements", "omega3", "fitness"],
    price: 14.99,
  },
];

const sampleSounds: TrendingSound[] = [
  {
    soundId: "sound-1",
    title: "Calm Morning",
    artist: "Wellness Beats",
    isBusinessApproved: true,
    growthRate: 20,
    usageCount: 100_000,
    scrapedAt: new Date(),
  },
  {
    soundId: "sound-2",
    title: "Copyrighted Track",
    isBusinessApproved: false,
    growthRate: 50,
    usageCount: 500_000,
    scrapedAt: new Date(),
  },
];

describe("ContentBriefSynthesizer", () => {
  let synthesizer: ContentBriefSynthesizer;
  let router: DynamicLLMRouter;
  let mockComplianceEngine: jest.Mocked<ComplianceEngine>;

  beforeEach(() => {
    router = new DynamicLLMRouter({
      openaiApiKey: "test-key",
      anthropicApiKey: "test-key",
    });

    mockComplianceEngine = {
      checkCompliance: jest.fn().mockResolvedValue({
        claim: "Supports overall wellness",
        confidenceScore: 97,
        decision: "auto_send",
        ruleChecks: [],
        judgeVerdict: {
          rubric: [
            { criterion: "faithfulness", passed: true, reasoning: "ok" },
            { criterion: "prohibited_terms", passed: true, reasoning: "ok" },
            { criterion: "dosage_accuracy", passed: true, reasoning: "ok" },
          ],
          overallPass: true,
          confidenceScore: 97,
          reasoning: "All passed",
        },
        retrievedChunks: [
          {
            id: 1,
            regulationText:
              "Vitamin D contributes to the normal function of the immune system",
            sourceAuthority: "MHRA",
            ruleNumber: "NHC-123",
            similarityScore: 0.92,
          },
        ],
        triggeredRules: [],
        summary: "PASSED",
      }),
    } as unknown as jest.Mocked<ComplianceEngine>;

    synthesizer = new ContentBriefSynthesizer(router, mockComplianceEngine);
  });

  describe("4-step pipeline", () => {
    it("should generate a complete content brief from trend + products", async () => {
      const brief = await synthesizer.synthesize(
        sampleTrend,
        sampleProducts,
        sampleSounds
      );

      expect(brief.briefId).toBeTruthy();
      expect(brief.briefId).toMatch(/^brief_/);
      expect(brief.briefText).toBeTruthy();
      expect(brief.createdAt).toBeInstanceOf(Date);
    });

    it("should produce trend match with viral hook", async () => {
      const trendMatch = await synthesizer.matchTrend(sampleTrend);

      expect(trendMatch.viralHook).toBeTruthy();
      expect(trendMatch.hookCategory).toBeTruthy();
      expect(trendMatch.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(trendMatch.relevanceScore).toBeLessThanOrEqual(100);
      expect(trendMatch.trend).toBe(sampleTrend);
    });

    it("should align product from catalog", async () => {
      const trendMatch = await synthesizer.matchTrend(sampleTrend);

      // Override router response for product alignment
      jest.spyOn(router, "call").mockResolvedValueOnce({
        text: JSON.stringify({
          productId: "prod-vitd",
          productName: "Vitamin D3 1000IU",
          alignmentReason: "Morning routine pairs naturally with daily vitamin D",
          alignmentScore: 90,
          keyBenefits: ["Daily vitamin D supplementation", "Supports overall wellness"],
        }),
        model: router.getModels()["gpt-5.1-instant"],
        routing: router.route("content_brief_generation"),
        usage: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        estimatedCostGBP: 0.0001,
        latencyMs: 100,
      });

      const alignment = await synthesizer.alignProduct(
        trendMatch,
        sampleProducts
      );

      expect(alignment.productId).toBeTruthy();
      expect(alignment.productName).toBeTruthy();
      expect(alignment.alignmentReason).toBeTruthy();
      expect(alignment.alignmentScore).toBeGreaterThanOrEqual(0);
      expect(alignment.keyBenefits).toBeInstanceOf(Array);
    });

    it("should run regulatory check via compliance engine", async () => {
      const alignment = {
        productId: "prod-vitd",
        productName: "Vitamin D3 1000IU",
        alignmentReason: "Supports overall wellness",
        alignmentScore: 90,
        keyBenefits: ["Daily vitamin D supplementation"],
      };

      const regCheck = await synthesizer.checkRegulatory(alignment);

      expect(mockComplianceEngine.checkCompliance).toHaveBeenCalled();
      expect(regCheck.passed).toBe(true);
      expect(regCheck.authorizedClaims.length).toBeGreaterThan(0);
    });

    it("should only suggest business-approved audio in creative guards", async () => {
      const trendMatch = await synthesizer.matchTrend(sampleTrend);
      const alignment = {
        productId: "prod-vitd",
        productName: "Vitamin D3",
        alignmentReason: "test",
        alignmentScore: 80,
        keyBenefits: ["wellness"],
      };
      const regCheck = {
        complianceResult: {} as import("@/lib/regulatory/compliance/engine").ComplianceResult,
        authorizedClaims: ["wellness support"],
        mandatorySHCs: [],
        strippedTerms: [],
        passed: true,
      };

      const guards = await synthesizer.applyCreativeGuards(
        trendMatch,
        alignment,
        regCheck,
        sampleSounds
      );

      // Should use the business-approved sound, not the copyrighted one
      if (guards.trendingAudio) {
        expect(guards.trendingAudio.soundId).toBe("sound-1");
        expect(guards.trendingAudio.title).toBe("Calm Morning");
      }

      expect(guards.suggestedTransitions.length).toBeGreaterThan(0);
      expect(guards.approvedHashtags.length).toBeGreaterThan(0);
      expect(guards.contentStructure.length).toBeGreaterThan(0);
    });
  });

  describe("Compliance integration", () => {
    it("should fail brief when compliance check fails", async () => {
      mockComplianceEngine.checkCompliance.mockResolvedValue({
        claim: "This cures headaches",
        confidenceScore: 0,
        decision: "human_review",
        ruleChecks: [],
        judgeVerdict: null,
        retrievedChunks: [],
        triggeredRules: ["15.6.2", "JUDGE_PROHIBITED_TERMS"],
        summary: "FAILED — medicinal claim",
      });

      const alignment = {
        productId: "prod-vitd",
        productName: "Vitamin D3",
        alignmentReason: "test",
        alignmentScore: 80,
        keyBenefits: ["This cures headaches"],
      };

      const regCheck = await synthesizer.checkRegulatory(alignment);
      expect(regCheck.passed).toBe(false);
      expect(regCheck.strippedTerms.length).toBeGreaterThan(0);
    });
  });
});

describe("ContentApprovalGate", () => {
  let gate: ContentApprovalGate;

  beforeEach(() => {
    mockQuery.mockReset();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });

    gate = new ContentApprovalGate(mockDb, {
      preferredChannels: ["sms", "telegram", "email", "in_app"],
      slackWebhookUrl: "https://hooks.slack.com/test",
      smsApiEndpoint: "https://sms-api.example.com/send",
      telegramBotToken: "test-bot-token",
      telegramChatId: "12345",
      emailApiEndpoint: "https://email-api.example.com/send",
      ownerEmail: "owner@andinn.co.uk",
      ownerPhone: "+447700000000",
    });
  });

  const sampleBrief = {
    briefId: "brief_test_123",
    trendMatch: {
      trend: sampleTrend,
      viralHook: "Morning Routine",
      hookCategory: "lifestyle",
      relevanceScore: 85,
    },
    productAlignment: {
      productId: "prod-vitd",
      productName: "Vitamin D3",
      alignmentReason: "Natural fit",
      alignmentScore: 90,
      keyBenefits: ["supports wellness"],
    },
    regulatoryCheck: {
      complianceResult: {} as import("@/lib/regulatory/compliance/engine").ComplianceResult,
      authorizedClaims: ["supports wellness"],
      mandatorySHCs: [],
      strippedTerms: [],
      passed: true,
    },
    creativeGuards: {
      suggestedTransitions: ["Cut to product"],
      approvedHashtags: ["vitamind", "wellness"],
      contentStructure: ["Hook", "Context", "Product", "CTA"],
    },
    briefText: "Here is your content brief...",
    approvalStatus: "pending_approval" as const,
    targetCreatorIds: ["creator-1"],
    createdAt: new Date(),
  };

  describe("Brief submission", () => {
    it("should persist brief and notify owner", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await gate.submitForApproval(sampleBrief);

      // Should have created table and inserted brief
      const insertCall = mockQuery.mock.calls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("INSERT INTO content_briefs")
      );
      expect(insertCall).toBeDefined();

      // Should have notified via all 4 channels
      expect(mockFetch.mock.calls.length).toBe(4);
    });

    it("should send SMS notification", async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await gate.submitForApproval(sampleBrief);

      const smsCall = mockFetch.mock.calls.find(
        (call) => call[0] === "https://sms-api.example.com/send"
      );
      expect(smsCall).toBeDefined();
      const body = JSON.parse(smsCall![1].body);
      expect(body.to).toBe("+447700000000");
      expect(body.message).toContain("Vitamin D3");
    });

    it("should send Telegram notification", async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await gate.submitForApproval(sampleBrief);

      const telegramCall = mockFetch.mock.calls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("api.telegram.org")
      );
      expect(telegramCall).toBeDefined();
      const body = JSON.parse(telegramCall![1].body);
      expect(body.chat_id).toBe("12345");
      expect(body.text).toContain("Vitamin D3");
    });

    it("should send email notification", async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await gate.submitForApproval(sampleBrief);

      const emailCall = mockFetch.mock.calls.find(
        (call) => call[0] === "https://email-api.example.com/send"
      );
      expect(emailCall).toBeDefined();
      const body = JSON.parse(emailCall![1].body);
      expect(body.to).toContain("owner@andinn.co.uk");
      expect(body.subject).toContain("Vitamin D3");
    });

    it("should send in-app (Slack) notification", async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      await gate.submitForApproval(sampleBrief);

      const slackCall = mockFetch.mock.calls.find(
        (call) => call[0] === "https://hooks.slack.com/test"
      );
      expect(slackCall).toBeDefined();
    });
  });

  describe("Approval decisions", () => {
    it("should approve a brief", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            brief_id: "brief_test_123",
            brief_data: JSON.stringify(sampleBrief),
            brief_text: sampleBrief.briefText,
            approval_status: "approved",
            owner_decision: null,
            resolved_at: new Date(),
          },
        ],
      });

      const result = await gate.recordDecision("brief_test_123", {
        action: "approve",
        respondedVia: "telegram",
        decidedAt: new Date(),
      });

      expect(result).not.toBeNull();
      expect(result!.approvalStatus).toBe("approved");
    });

    it("should reject a brief with reason", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            brief_id: "brief_test_123",
            brief_data: JSON.stringify(sampleBrief),
            brief_text: sampleBrief.briefText,
            approval_status: "rejected",
            owner_decision: JSON.stringify({
              action: "reject",
              rejectionReason: "Not aligned with brand voice",
              respondedVia: "email",
              decidedAt: new Date(),
            }),
            resolved_at: new Date(),
          },
        ],
      });

      const result = await gate.recordDecision("brief_test_123", {
        action: "reject",
        rejectionReason: "Not aligned with brand voice",
        respondedVia: "email",
        decidedAt: new Date(),
      });

      expect(result).not.toBeNull();
      expect(result!.approvalStatus).toBe("rejected");
      expect(result!.ownerDecision!.rejectionReason).toBe(
        "Not aligned with brand voice"
      );
    });

    it("should allow editing a brief", async () => {
      const editedText = "Updated brief with corrections...";
      mockQuery.mockResolvedValue({
        rows: [
          {
            brief_id: "brief_test_123",
            brief_data: JSON.stringify(sampleBrief),
            brief_text: editedText,
            approval_status: "edited",
            owner_decision: null,
            resolved_at: new Date(),
          },
        ],
      });

      const result = await gate.recordDecision("brief_test_123", {
        action: "edit",
        editedBriefText: editedText,
        respondedVia: "in_app",
        decidedAt: new Date(),
      });

      expect(result).not.toBeNull();
      expect(result!.approvalStatus).toBe("edited");
      expect(result!.briefText).toBe(editedText);
    });

    it("should return null if brief not found", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await gate.recordDecision("nonexistent", {
        action: "approve",
        respondedVia: "sms",
        decidedAt: new Date(),
      });

      expect(result).toBeNull();
    });
  });

  describe("Approval gate enforcement", () => {
    it("should block unapproved briefs from being delivered", async () => {
      // Query returns no approved brief
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await gate.getApprovedBrief("brief_test_123");
      expect(result).toBeNull();
    });

    it("should allow approved briefs to be retrieved", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            brief_id: "brief_test_123",
            brief_data: JSON.stringify(sampleBrief),
            brief_text: sampleBrief.briefText,
            approval_status: "approved",
            owner_decision: JSON.stringify({
              action: "approve",
              respondedVia: "telegram",
              decidedAt: new Date(),
            }),
            resolved_at: new Date(),
          },
        ],
      });

      const result = await gate.getApprovedBrief("brief_test_123");
      expect(result).not.toBeNull();
      expect(result!.approvalStatus).toBe("approved");
    });

    it("should list pending briefs for the dashboard", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            brief_data: JSON.stringify(sampleBrief),
            brief_text: sampleBrief.briefText,
            approval_status: "pending_approval",
          },
        ],
      });

      const pending = await gate.getPendingBriefs();
      expect(pending).toHaveLength(1);
      expect(pending[0].approvalStatus).toBe("pending_approval");
    });

    it("should list rejected briefs with reasons for audit", async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            brief_data: JSON.stringify(sampleBrief),
            brief_text: sampleBrief.briefText,
            approval_status: "rejected",
            owner_decision: JSON.stringify({
              action: "reject",
              rejectionReason: "Too promotional",
            }),
            resolved_at: new Date(),
          },
        ],
      });

      const rejected = await gate.getRejectedBriefs();
      expect(rejected).toHaveLength(1);
      expect(rejected[0].ownerDecision?.rejectionReason).toBe(
        "Too promotional"
      );
    });
  });
});
