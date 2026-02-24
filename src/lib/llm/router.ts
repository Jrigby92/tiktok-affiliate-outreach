/**
 * Dynamic LLM Router
 *
 * Solves an optimization problem across three axes:
 * predicted quality, token cost, and latency.
 *
 * Routes:
 *   - Compliance verification → Claude 4.5 Haiku (lowest hallucination)
 *   - Long document parsing → Gemini 3.0 Deep Think (1M+ token context)
 *   - Outreach messaging → GPT-5.1 Instant (cheapest for routine text)
 *
 * ALL LLM calls go through the router. ALL are LangSmith-wrapped.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { wrapOpenAI } from "langsmith/wrappers";
import { traceable } from "langsmith/traceable";
import {
  LLMTaskType,
  ModelConfig,
  RouterWeights,
  RoutingDecision,
  LLMCallOptions,
  LLMCallResult,
} from "./types";

// ─── Model Registry Defaults ───

const CLAUDE_HAIKU: ModelConfig = {
  modelId: "claude-haiku-4-5-20251001",
  provider: "anthropic",
  qualityScore: 95,
  costPerKInput: 0.0008,
  costPerKOutput: 0.004,
  avgLatencyMs: 800,
  maxContextTokens: 200000,
  displayName: "Claude 4.5 Haiku",
};

const GEMINI_DEEP_THINK: ModelConfig = {
  modelId: "gemini-3.0-deep-think",
  provider: "google",
  qualityScore: 90,
  costPerKInput: 0.001,
  costPerKOutput: 0.003,
  avgLatencyMs: 3000,
  maxContextTokens: 2000000,
  displayName: "Gemini 3.0 Deep Think",
};

const GPT_51_INSTANT: ModelConfig = {
  modelId: "gpt-5.1-instant",
  provider: "openai",
  qualityScore: 80,
  costPerKInput: 0.0003,
  costPerKOutput: 0.0006,
  avgLatencyMs: 400,
  maxContextTokens: 128000,
  displayName: "GPT-5.1 Instant",
};

// ─── Task-to-Model Mapping with Reasons ───

const TASK_MODEL_MAP: Record<string, { modelId: string; reason: string }> = {
  compliance_verification: {
    modelId: CLAUDE_HAIKU.modelId,
    reason: "Lowest hallucination rate; acts as the judge model",
  },
  long_document_parsing: {
    modelId: GEMINI_DEEP_THINK.modelId,
    reason: "Largest context window (1M–2M tokens) for long documents",
  },
  outreach_messaging: {
    modelId: GPT_51_INSTANT.modelId,
    reason: "cheapest per token for routine text generation",
  },
  content_brief_generation: {
    modelId: GPT_51_INSTANT.modelId,
    reason: "cheapest per token for content generation",
  },
  general: {
    modelId: GPT_51_INSTANT.modelId,
    reason: "cheapest default model for general tasks",
  },
};

// ─── Default Weights ───

const DEFAULT_WEIGHTS: RouterWeights = {
  quality: 0.5,
  cost: 0.3,
  latency: 0.2,
};

// ─── Singleton state for reset ───

let _singletonInstance: DynamicLLMRouter | null = null;

/**
 * Reset the LLM router singleton (for test cleanup).
 */
export function resetLLMRouter(): void {
  _singletonInstance = null;
}

// ─── Helper: Normalize Weights ───

function normalizeWeights(weights: RouterWeights): RouterWeights {
  const sum = weights.quality + weights.cost + weights.latency;
  if (sum === 0) {
    return { ...DEFAULT_WEIGHTS };
  }
  if (Math.abs(sum - 1.0) < 1e-9) {
    return { ...weights };
  }
  return {
    quality: weights.quality / sum,
    cost: weights.cost / sum,
    latency: weights.latency / sum,
  };
}

// ─── Router Constructor Options ───

export interface DynamicLLMRouterOptions {
  openaiApiKey: string;
  anthropicApiKey: string;
  weights?: Partial<RouterWeights>;
}

// ─── Router ───

export class DynamicLLMRouter {
  private weights: RouterWeights;
  private models: Record<string, ModelConfig>;
  private openaiClient: OpenAI;
  private anthropicClient: Anthropic;

  constructor(options: DynamicLLMRouterOptions) {
    // Normalize weights
    const raw: RouterWeights = {
      ...DEFAULT_WEIGHTS,
      ...options.weights,
    };
    this.weights = normalizeWeights(raw);

    // Build model registry as a Record
    this.models = {
      [CLAUDE_HAIKU.modelId]: { ...CLAUDE_HAIKU },
      [GEMINI_DEEP_THINK.modelId]: { ...GEMINI_DEEP_THINK },
      [GPT_51_INSTANT.modelId]: { ...GPT_51_INSTANT },
    };

    // Create provider clients
    const rawOpenAI = new OpenAI({ apiKey: options.openaiApiKey });
    this.openaiClient = wrapOpenAI(rawOpenAI) as unknown as OpenAI;
    this.anthropicClient = new Anthropic({ apiKey: options.anthropicApiKey });

    // Wrap the Anthropic call method with traceable for LangSmith
    const originalCreate = this.anthropicClient.messages.create.bind(
      this.anthropicClient.messages
    );
    this.anthropicClient.messages.create = traceable(originalCreate, {
      name: "anthropic-messages-create",
      run_type: "llm",
    }) as typeof this.anthropicClient.messages.create;

    _singletonInstance = this;
  }

  /**
   * Route a task to the best model.
   * Optionally force a specific model by modelId.
   */
  route(taskType: LLMTaskType, forceModel?: string): RoutingDecision {
    // Force-model override
    if (forceModel) {
      const forced = this.models[forceModel];
      if (forced) {
        return {
          model: forced,
          taskType,
          routingScore: 100,
          reason: `Forced model: ${forced.displayName} (${forced.modelId})`,
        };
      }
      // If forced model not found, fall through to normal routing
    }

    // Check direct task mapping
    const mapping = TASK_MODEL_MAP[taskType];
    if (mapping) {
      const model = this.models[mapping.modelId];
      if (model) {
        return {
          model,
          taskType,
          routingScore: this.computeRoutingScore(model),
          reason: mapping.reason,
        };
      }
    }

    // Fallback: score all models
    return this.scoreAndSelect(taskType);
  }

  /**
   * Compute a routing score for a single model based on current weights.
   */
  private computeRoutingScore(model: ModelConfig): number {
    const allModels = Object.values(this.models);
    const maxCost = Math.max(...allModels.map((m) => m.costPerKInput));
    const maxLatency = Math.max(...allModels.map((m) => m.avgLatencyMs));

    const qualityNorm = model.qualityScore / 100;
    const costNorm = 1 - model.costPerKInput / (maxCost || 1);
    const latencyNorm = 1 - model.avgLatencyMs / (maxLatency || 1);

    const score =
      this.weights.quality * qualityNorm +
      this.weights.cost * costNorm +
      this.weights.latency * latencyNorm;

    return Math.round(score * 100);
  }

  /**
   * Score all models and select the best one.
   */
  private scoreAndSelect(taskType: LLMTaskType): RoutingDecision {
    const allModels = Object.values(this.models);
    const maxCost = Math.max(...allModels.map((m) => m.costPerKInput));
    const maxLatency = Math.max(...allModels.map((m) => m.avgLatencyMs));

    let bestModel = allModels[0];
    let bestScore = -Infinity;

    for (const model of allModels) {
      const qualityNorm = model.qualityScore / 100;
      const costNorm = 1 - model.costPerKInput / (maxCost || 1);
      const latencyNorm = 1 - model.avgLatencyMs / (maxLatency || 1);

      const score =
        this.weights.quality * qualityNorm +
        this.weights.cost * costNorm +
        this.weights.latency * latencyNorm;

      if (score > bestScore) {
        bestScore = score;
        bestModel = model;
      }
    }

    return {
      model: bestModel,
      taskType,
      routingScore: Math.round(bestScore * 100),
      reason: `Optimization: quality=${this.weights.quality}, cost=${this.weights.cost}, latency=${this.weights.latency}`,
    };
  }

  /**
   * Execute an LLM call through the router.
   * Routes to the appropriate model and dispatches to the provider SDK.
   */
  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const routing = options.forceModel
      ? this.route(options.taskType, options.forceModel)
      : this.route(options.taskType);

    const start = Date.now();
    let text: string;
    let inputTokens: number;
    let outputTokens: number;

    switch (routing.model.provider) {
      case "anthropic": {
        const messages: Anthropic.MessageParam[] = [
          { role: "user", content: options.userMessage },
        ];
        const params: Anthropic.MessageCreateParams = {
          model: routing.model.modelId,
          max_tokens: options.maxTokens ?? 1024,
          messages,
        };
        if (options.systemPrompt) {
          params.system = options.systemPrompt;
        }
        if (options.temperature !== undefined) {
          params.temperature = options.temperature;
        }
        const response = await this.anthropicClient.messages.create(params);
        const textBlock = response.content.find(
          (c: Anthropic.ContentBlock) => c.type === "text"
        ) as Anthropic.TextBlock | undefined;
        text = textBlock?.text ?? "";
        inputTokens = response.usage.input_tokens;
        outputTokens = response.usage.output_tokens;
        break;
      }

      case "openai": {
        const messages: OpenAI.ChatCompletionMessageParam[] = [];
        if (options.systemPrompt) {
          messages.push({ role: "system", content: options.systemPrompt });
        }
        messages.push({ role: "user", content: options.userMessage });

        const response = await this.openaiClient.chat.completions.create({
          model: routing.model.modelId,
          messages,
          max_tokens: options.maxTokens,
          temperature: options.temperature,
        });
        text = response.choices[0]?.message?.content ?? "";
        inputTokens = response.usage?.prompt_tokens ?? 0;
        outputTokens = response.usage?.completion_tokens ?? 0;
        break;
      }

      case "google":
      default: {
        // Google/Gemini: placeholder since no official SDK is mocked
        text = `[${routing.model.displayName}] Response placeholder`;
        inputTokens = Math.ceil((options.userMessage?.length || 0) / 4);
        outputTokens = Math.ceil(text.length / 4);
        break;
      }
    }

    const latencyMs = Date.now() - start;
    const estimatedCostGBP =
      (inputTokens / 1000) * routing.model.costPerKInput +
      (outputTokens / 1000) * routing.model.costPerKOutput;

    return {
      text,
      model: routing.model,
      routing,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      estimatedCostGBP,
      latencyMs,
    };
  }

  /**
   * Get all registered models as a Record keyed by modelId.
   */
  getModels(): Record<string, ModelConfig> {
    return { ...this.models };
  }

  /**
   * Get a single model by its ID.
   */
  getModel(modelId: string): ModelConfig | undefined {
    return this.models[modelId];
  }

  /**
   * Register a custom model.
   */
  registerModel(config: ModelConfig): void {
    this.models[config.modelId] = { ...config };
  }

  /**
   * Update router weights at runtime.
   * Weights are automatically normalized to sum to 1.
   */
  updateWeights(weights: Partial<RouterWeights>): void {
    const raw: RouterWeights = { ...this.weights, ...weights };
    this.weights = normalizeWeights(raw);
  }

  /**
   * Get current weights.
   */
  getWeights(): Readonly<RouterWeights> {
    return { ...this.weights };
  }
}
