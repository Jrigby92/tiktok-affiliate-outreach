/**
 * A/B Testing Framework & Reinforcement Learning Loop — Tests
 *
 * Tests:
 * - Experiment creation with variants
 * - Deterministic variant assignment via hashing
 * - Outcome recording and aggregation
 * - Experiment lifecycle (draft → running → completed)
 * - RL loop: Pearson correlation, weight recommendations
 * - Feature recording and conversion tracking
 */

import { ABTestingFramework } from "@/lib/experiments/framework";
import { ReinforcementLoop } from "@/lib/experiments/reinforcement-loop";
import {
  ExperimentVariant,
  CommissionTierVariant,
  PitchMessageVariant,
  SampleThresholdVariant,
} from "@/lib/experiments/types";
import { Pool } from "pg";

// ─── Mocks ───

jest.mock("langsmith/traceable", () => ({
  traceable: jest.fn((fn) => fn),
}));

jest.mock("langsmith/wrappers", () => ({
  wrapOpenAI: (client: unknown) => client,
}));

const mockDbQuery = jest.fn();
const mockDbConnect = jest.fn();
const mockDb = {
  query: mockDbQuery,
  connect: mockDbConnect,
} as unknown as Pool;

// ─── Test Data ───

const COMMISSION_VARIANTS: ExperimentVariant[] = [
  {
    id: "v-control",
    name: "10% Commission (Control)",
    config: { type: "commission_tier", commissionPercent: 10 } as CommissionTierVariant,
    isControl: true,
  },
  {
    id: "v-treatment",
    name: "15% Commission (Treatment)",
    config: { type: "commission_tier", commissionPercent: 15 } as CommissionTierVariant,
    isControl: false,
  },
];

const PITCH_VARIANTS: ExperimentVariant[] = [
  {
    id: "v-pitch-a",
    name: "Pitch Template A",
    config: {
      type: "pitch_message",
      template: "Hi {creatorName}, we'd love to collaborate on {productName}!",
    } as PitchMessageVariant,
    isControl: true,
  },
  {
    id: "v-pitch-b",
    name: "Pitch Template B",
    config: {
      type: "pitch_message",
      template: "Hey {creatorName}! {productName} is trending — want to partner?",
    } as PitchMessageVariant,
    isControl: false,
  },
];

const SAMPLE_VARIANTS: ExperimentVariant[] = [
  {
    id: "v-strict",
    name: "Strict Threshold (5%)",
    config: { type: "sample_threshold", autoApproveThreshold: 0.05 } as SampleThresholdVariant,
    isControl: true,
  },
  {
    id: "v-relaxed",
    name: "Relaxed Threshold (2%)",
    config: { type: "sample_threshold", autoApproveThreshold: 0.02 } as SampleThresholdVariant,
    isControl: false,
  },
];

// ─── Tests ───

describe("ABTestingFramework", () => {
  let framework: ABTestingFramework;

  beforeEach(() => {
    jest.clearAllMocks();
    framework = new ABTestingFramework(mockDb);
  });

  describe("createExperiment", () => {
    it("creates a commission tier experiment", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const experiment = await framework.createExperiment(
        "Commission Tier Test",
        "commission_tier",
        COMMISSION_VARIANTS,
        { "v-control": 0.5, "v-treatment": 0.5 }
      );

      expect(experiment.name).toBe("Commission Tier Test");
      expect(experiment.type).toBe("commission_tier");
      expect(experiment.status).toBe("draft");
      expect(experiment.variants).toHaveLength(2);
      expect(experiment.trafficSplit["v-control"]).toBe(0.5);
      expect(experiment.id).toMatch(/^exp_/);
    });

    it("creates a pitch message experiment", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const experiment = await framework.createExperiment(
        "Pitch Template Test",
        "pitch_message",
        PITCH_VARIANTS
      );

      expect(experiment.type).toBe("pitch_message");
      expect(experiment.variants[0].config).toEqual({
        type: "pitch_message",
        template: "Hi {creatorName}, we'd love to collaborate on {productName}!",
      });
    });

    it("creates a sample threshold experiment", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const experiment = await framework.createExperiment(
        "Sample Threshold Test",
        "sample_threshold",
        SAMPLE_VARIANTS
      );

      expect(experiment.type).toBe("sample_threshold");
    });

    it("rejects traffic split that doesn't sum to 1.0", async () => {
      await expect(
        framework.createExperiment(
          "Bad Split",
          "commission_tier",
          COMMISSION_VARIANTS,
          { "v-control": 0.3, "v-treatment": 0.3 }
        )
      ).rejects.toThrow("Traffic split must sum to 1.0");
    });

    it("defaults to even split when not provided", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const experiment = await framework.createExperiment(
        "Even Split",
        "commission_tier",
        COMMISSION_VARIANTS
      );

      expect(experiment.trafficSplit["v-control"]).toBe(0.5);
      expect(experiment.trafficSplit["v-treatment"]).toBe(0.5);
    });
  });

  describe("experiment lifecycle", () => {
    it("starts an experiment", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await framework.startExperiment("exp_123");

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'running'"),
        ["exp_123"]
      );
    });

    it("pauses an experiment", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await framework.pauseExperiment("exp_123");

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'paused'"),
        ["exp_123"]
      );
    });

    it("completes an experiment", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await framework.completeExperiment("exp_123");

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'completed'"),
        ["exp_123"]
      );
    });
  });

  describe("assignVariant", () => {
    it("returns existing assignment if already assigned", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            experiment_id: "exp_123",
            variant_id: "v-control",
            subject_key: "creator-1",
            assigned_at: new Date(),
          },
        ],
      });

      const assignment = await framework.assignVariant("exp_123", "creator-1");

      expect(assignment.variantId).toBe("v-control");
      expect(assignment.subjectKey).toBe("creator-1");
    });

    it("creates new assignment for unknown subject", async () => {
      // No existing assignment
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      // Get experiment
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "exp_123",
            name: "Test",
            type: "commission_tier",
            status: "running",
            variants: JSON.stringify(COMMISSION_VARIANTS),
            traffic_split: JSON.stringify({
              "v-control": 0.5,
              "v-treatment": 0.5,
            }),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });
      // Insert assignment
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const assignment = await framework.assignVariant("exp_123", "creator-2");

      expect(assignment.experimentId).toBe("exp_123");
      expect(["v-control", "v-treatment"]).toContain(assignment.variantId);
    });

    it("throws when experiment is not running", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "exp_123",
            name: "Test",
            type: "commission_tier",
            status: "draft",
            variants: JSON.stringify(COMMISSION_VARIANTS),
            traffic_split: JSON.stringify({ "v-control": 0.5, "v-treatment": 0.5 }),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      await expect(
        framework.assignVariant("exp_123", "creator-1")
      ).rejects.toThrow("not running");
    });

    it("produces deterministic assignments (same subject → same variant)", async () => {
      // First call
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "exp_123",
            name: "Test",
            type: "commission_tier",
            status: "running",
            variants: JSON.stringify(COMMISSION_VARIANTS),
            traffic_split: JSON.stringify({
              "v-control": 0.5,
              "v-treatment": 0.5,
            }),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const first = await framework.assignVariant("exp_123", "creator-stable");

      // Second call (same subject)
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "exp_123",
            name: "Test",
            type: "commission_tier",
            status: "running",
            variants: JSON.stringify(COMMISSION_VARIANTS),
            traffic_split: JSON.stringify({
              "v-control": 0.5,
              "v-treatment": 0.5,
            }),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const second = await framework.assignVariant("exp_123", "creator-stable");

      expect(first.variantId).toBe(second.variantId);
    });
  });

  describe("recordOutcome", () => {
    it("records an outcome for an assigned subject", async () => {
      // Look up assignment
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ variant_id: "v-control" }],
      });
      // Insert outcome
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const outcome = await framework.recordOutcome(
        "exp_123",
        "creator-1",
        "acceptance_rate",
        0.85,
        { source: "test" }
      );

      expect(outcome.metric).toBe("acceptance_rate");
      expect(outcome.value).toBe(0.85);
      expect(outcome.variantId).toBe("v-control");
    });

    it("throws when no assignment exists", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        framework.recordOutcome("exp_123", "unassigned", "metric", 1.0)
      ).rejects.toThrow("No variant assignment found");
    });
  });

  describe("getExperimentResults", () => {
    it("aggregates results by variant", async () => {
      // Get experiment
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "exp_123",
            name: "Commission Test",
            type: "commission_tier",
            status: "completed",
            variants: JSON.stringify(COMMISSION_VARIANTS),
            traffic_split: JSON.stringify({
              "v-control": 0.5,
              "v-treatment": 0.5,
            }),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });
      // Assignment counts
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          { variant_id: "v-control", count: "50" },
          { variant_id: "v-treatment", count: "50" },
        ],
      });
      // Outcome aggregates
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            variant_id: "v-control",
            metric: "acceptance_rate",
            count: "50",
            sum: "40",
            mean: "0.8",
          },
          {
            variant_id: "v-treatment",
            metric: "acceptance_rate",
            count: "50",
            sum: "45",
            mean: "0.9",
          },
        ],
      });
      // Total subjects
      mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "100" }] });
      // Total outcomes
      mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "100" }] });

      const results = await framework.getExperimentResults("exp_123");

      expect(results.experimentName).toBe("Commission Test");
      expect(results.totalSubjects).toBe(100);
      expect(results.variantResults).toHaveLength(2);

      const control = results.variantResults.find(
        (v) => v.variantId === "v-control"
      );
      expect(control!.isControl).toBe(true);
      expect(control!.sampleSize).toBe(50);
      expect(control!.metrics["acceptance_rate"].mean).toBe(0.8);

      const treatment = results.variantResults.find(
        (v) => v.variantId === "v-treatment"
      );
      expect(treatment!.metrics["acceptance_rate"].mean).toBe(0.9);
    });
  });

  describe("initTables", () => {
    it("creates experiment tables", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      await framework.initTables();

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS experiments")
      );
    });
  });
});

// ─── Reinforcement Learning Loop ───

describe("ReinforcementLoop", () => {
  let framework: ABTestingFramework;
  let loop: ReinforcementLoop;

  beforeEach(() => {
    jest.clearAllMocks();
    framework = new ABTestingFramework(mockDb);
    loop = new ReinforcementLoop(mockDb, framework);
  });

  describe("initTables", () => {
    it("creates RL tables", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      await loop.initTables();

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("conversion_events")
      );
    });
  });

  describe("recordConversion", () => {
    it("records a conversion event", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await loop.recordConversion({
        creatorId: "creator-1",
        productId: "product-1",
        revenue: 25.0,
        unitsSold: 1,
        commissionPaid: 2.5,
        timestamp: new Date(),
      });

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO conversion_events"),
        expect.arrayContaining(["creator-1", "product-1", 25.0, 1, 2.5])
      );
    });
  });

  describe("recordFeatures", () => {
    it("records features with upsert", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await loop.recordFeatures({
        creatorId: "creator-1",
        productId: "product-1",
        nicheAlignment: 0.8,
        engagementQuality: 0.7,
        audienceOverlap: 0.6,
        conversionPotential: 0.5,
        followerGrowthRate: 0.1,
        commentSentiment: 0.75,
        engagementRate: 0.05,
        historicalConversion: 0.03,
      });

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO conversion_features"),
        expect.arrayContaining(["creator-1", "product-1"])
      );
    });
  });

  describe("analyzeAndRecommendWeights", () => {
    it("returns default weights with low confidence when insufficient data", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // No data

      const recommendation = await loop.analyzeAndRecommendWeights();

      expect(recommendation.confidence).toBe(0);
      expect(recommendation.sampleSize).toBe(0);
      expect(recommendation.weights.nicheAlignment).toBe(0.3);
    });

    it("computes weight recommendations from conversion data", async () => {
      // Return enough data points for analysis
      const mockRows = [];
      for (let i = 0; i < 20; i++) {
        mockRows.push({
          niche_alignment: String(50 + i * 2),
          engagement_quality: String(40 + i),
          audience_overlap: String(30 + i * 1.5),
          conversion_potential: String(20 + i),
          follower_growth_rate: String(0.05 + i * 0.01),
          comment_sentiment: String(0.5 + i * 0.02),
          engagement_rate: String(0.03 + i * 0.005),
          historical_conversion: String(0.01 + i * 0.002),
          total_revenue: String(i * 10),
          total_units: String(i),
        });
      }
      mockDbQuery.mockResolvedValueOnce({ rows: mockRows });
      // Insert into weight_history
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const recommendation = await loop.analyzeAndRecommendWeights();

      expect(recommendation.sampleSize).toBe(20);
      expect(recommendation.confidence).toBeGreaterThan(0);
      // Weights should sum to ~1.0
      const weightSum =
        recommendation.weights.nicheAlignment +
        recommendation.weights.engagementQuality +
        recommendation.weights.audienceOverlap +
        recommendation.weights.conversionPotential;
      expect(weightSum).toBeCloseTo(1.0, 1);
      // Feature importance should include all features
      expect(recommendation.featureImportance).toHaveProperty(
        "niche_alignment"
      );
      expect(recommendation.featureImportance).toHaveProperty(
        "engagement_quality"
      );
    });
  });

  describe("getWeightHistory", () => {
    it("returns weight history entries", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            weights: JSON.stringify({
              nicheAlignment: 0.35,
              engagementQuality: 0.25,
              audienceOverlap: 0.2,
              conversionPotential: 0.2,
            }),
            confidence: "0.75",
            sample_size: 50,
            feature_importance: JSON.stringify({ niche_alignment: 0.8 }),
            applied_at: new Date(),
          },
        ],
      });

      const history = await loop.getWeightHistory(5);

      expect(history).toHaveLength(1);
      expect(history[0].weights.nicheAlignment).toBe(0.35);
      expect(history[0].confidence).toBe(0.75);
    });
  });
});
