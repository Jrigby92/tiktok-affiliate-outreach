/**
 * Dynamic LLM Router Tests
 *
 * Verifies:
 * - Task-type → model routing is correct for all three types
 * - LangSmith wrapping is verified
 * - Weights optimization works
 * - Force-model override works
 */

import { DynamicLLMRouter, resetLLMRouter } from "@/lib/llm/router";
import { LLMTaskType } from "@/lib/llm/types";

// Mock OpenAI
jest.mock("openai", () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: "Mocked response" } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        }),
      },
    },
  }));
});

// Mock Anthropic
jest.mock("@anthropic-ai/sdk", () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "Mocked Anthropic response" }],
        usage: { input_tokens: 80, output_tokens: 40 },
      }),
    },
  }));
});

// Mock LangSmith wrappers
jest.mock("langsmith/wrappers", () => ({
  wrapOpenAI: jest.fn((client) => client),
}));

jest.mock("langsmith/traceable", () => ({
  traceable: jest.fn((fn) => fn),
}));

describe("DynamicLLMRouter", () => {
  let router: DynamicLLMRouter;

  beforeEach(() => {
    resetLLMRouter();
    router = new DynamicLLMRouter({
      openaiApiKey: "test-openai-key",
      anthropicApiKey: "test-anthropic-key",
    });
  });

  afterEach(() => {
    resetLLMRouter();
  });

  describe("Routing decisions", () => {
    it("should route compliance_verification to Claude 4.5 Haiku", () => {
      const decision = router.route("compliance_verification");
      expect(decision.model.modelId).toBe("claude-haiku-4-5-20251001");
      expect(decision.model.provider).toBe("anthropic");
      expect(decision.model.displayName).toBe("Claude 4.5 Haiku");
      expect(decision.reason).toContain("hallucination");
    });

    it("should route long_document_parsing to Gemini 3.0 Deep Think", () => {
      const decision = router.route("long_document_parsing");
      expect(decision.model.modelId).toBe("gemini-3.0-deep-think");
      expect(decision.model.provider).toBe("google");
      expect(decision.model.displayName).toBe("Gemini 3.0 Deep Think");
      expect(decision.reason).toContain("context window");
    });

    it("should route outreach_messaging to GPT-5.1 Instant", () => {
      const decision = router.route("outreach_messaging");
      expect(decision.model.modelId).toBe("gpt-5.1-instant");
      expect(decision.model.provider).toBe("openai");
      expect(decision.model.displayName).toBe("GPT-5.1 Instant");
      expect(decision.reason).toContain("cheapest");
    });

    it("should route content_brief_generation to GPT-5.1 Instant", () => {
      const decision = router.route("content_brief_generation");
      expect(decision.model.modelId).toBe("gpt-5.1-instant");
    });

    it("should route general tasks to GPT-5.1 Instant", () => {
      const decision = router.route("general");
      expect(decision.model.modelId).toBe("gpt-5.1-instant");
    });

    it("should include task type in routing decision", () => {
      const taskTypes: LLMTaskType[] = [
        "compliance_verification",
        "long_document_parsing",
        "outreach_messaging",
      ];

      for (const taskType of taskTypes) {
        const decision = router.route(taskType);
        expect(decision.taskType).toBe(taskType);
      }
    });
  });

  describe("Force model override", () => {
    it("should use forced model when specified", () => {
      const decision = router.route(
        "outreach_messaging",
        "claude-haiku-4-5-20251001"
      );
      expect(decision.model.modelId).toBe("claude-haiku-4-5-20251001");
      expect(decision.reason).toContain("Forced model");
      expect(decision.routingScore).toBe(100);
    });

    it("should fall back to normal routing if forced model not found", () => {
      const decision = router.route("outreach_messaging", "nonexistent-model");
      expect(decision.model.modelId).toBe("gpt-5.1-instant");
    });
  });

  describe("Weight configuration", () => {
    it("should accept custom weights", () => {
      const customRouter = new DynamicLLMRouter({
        openaiApiKey: "key",
        anthropicApiKey: "key",
        weights: { quality: 0.8, cost: 0.1, latency: 0.1 },
      });

      const weights = customRouter.getWeights();
      expect(weights.quality).toBe(0.8);
      expect(weights.cost).toBe(0.1);
      expect(weights.latency).toBe(0.1);
    });

    it("should normalize weights to sum to 1", () => {
      const customRouter = new DynamicLLMRouter({
        openaiApiKey: "key",
        anthropicApiKey: "key",
        weights: { quality: 2, cost: 2, latency: 1 },
      });

      const weights = customRouter.getWeights();
      const total = weights.quality + weights.cost + weights.latency;
      expect(total).toBeCloseTo(1.0);
    });

    it("should allow weight updates at runtime", () => {
      router.updateWeights({ quality: 0.9, cost: 0.05, latency: 0.05 });
      const weights = router.getWeights();
      expect(weights.quality).toBeCloseTo(0.9);
    });
  });

  describe("Model registry", () => {
    it("should have 3 models registered by default", () => {
      const models = router.getModels();
      expect(Object.keys(models)).toHaveLength(3);
      expect(models["claude-haiku-4-5-20251001"]).toBeDefined();
      expect(models["gemini-3.0-deep-think"]).toBeDefined();
      expect(models["gpt-5.1-instant"]).toBeDefined();
    });

    it("should allow custom model registration", () => {
      router.registerModel({
        modelId: "custom-model",
        provider: "openai",
        qualityScore: 85,
        costPerKInput: 0.0005,
        costPerKOutput: 0.001,
        avgLatencyMs: 600,
        maxContextTokens: 64_000,
        displayName: "Custom Model",
      });

      const models = router.getModels();
      expect(models["custom-model"]).toBeDefined();
      expect(models["custom-model"].displayName).toBe("Custom Model");
    });
  });

  describe("LLM call execution", () => {
    it("should call Anthropic for compliance tasks", async () => {
      const result = await router.call({
        taskType: "compliance_verification",
        userMessage: "Check this claim: Vitamin D supports immune function",
        maxTokens: 256,
      });

      expect(result.model.provider).toBe("anthropic");
      expect(result.text).toBe("Mocked Anthropic response");
      expect(result.usage.inputTokens).toBe(80);
      expect(result.usage.outputTokens).toBe(40);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.estimatedCostGBP).toBeGreaterThanOrEqual(0);
    });

    it("should call OpenAI for outreach tasks", async () => {
      const result = await router.call({
        taskType: "outreach_messaging",
        userMessage: "Write an outreach message for a wellness creator",
        maxTokens: 256,
      });

      expect(result.model.provider).toBe("openai");
      expect(result.text).toBe("Mocked response");
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
    });

    it("should include routing decision in result", async () => {
      const result = await router.call({
        taskType: "compliance_verification",
        userMessage: "Test",
      });

      expect(result.routing.taskType).toBe("compliance_verification");
      expect(result.routing.model.modelId).toBe("claude-haiku-4-5-20251001");
      expect(result.routing.reason).toBeTruthy();
    });

    it("should support system prompt", async () => {
      const result = await router.call({
        taskType: "outreach_messaging",
        systemPrompt: "You are a marketing assistant.",
        userMessage: "Help me write copy",
      });

      expect(result.text).toBeTruthy();
    });

    it("should calculate estimated cost", async () => {
      const result = await router.call({
        taskType: "outreach_messaging",
        userMessage: "Test message",
      });

      expect(result.estimatedCostGBP).toBeGreaterThanOrEqual(0);
      expect(typeof result.estimatedCostGBP).toBe("number");
    });
  });

  describe("LangSmith tracing", () => {
    it("should wrap OpenAI client with wrapOpenAI", () => {
      // wrapOpenAI is mocked at the top of this file and called during construction
      const wrapOpenAI = jest.requireMock("langsmith/wrappers").wrapOpenAI;
      expect(wrapOpenAI).toHaveBeenCalled();
    });

    it("should wrap Anthropic calls with traceable", () => {
      // traceable is mocked at the top and used for Anthropic and Google calls
      const traceable = jest.requireMock("langsmith/traceable").traceable;
      expect(traceable).toHaveBeenCalled();
    });
  });
});
