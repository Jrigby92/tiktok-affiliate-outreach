/**
 * Dashboard & HITL & Approval Tests — Section 8
 *
 * Tests:
 * - Dashboard queries return structured data
 * - HITL review queue stores and retrieves reviews
 * - Content approval gate enforces Rule #1
 * - GDPR erasure endpoint removes PII
 * - Threshold tuner analyzes review data
 */

import { Pool } from "pg";
import {
  getActiveCollaborations,
  getCollaborationStats,
  getPendingBriefs,
  getPendingReviews,
  getRecentActivity,
  getOrderStats,
  updateBriefStatus,
  updateReviewDecision,
  insertReview,
  logActivity,
} from "@/lib/dashboard/queries";
import { ThresholdTuner } from "@/lib/regulatory/compliance/threshold-tuner";
import { eraseAllPiiForSubject } from "@/lib/db/pii-scrubber";

jest.mock("langsmith/traceable", () => ({
  traceable: jest.fn((fn) => fn),
}));

jest.mock("langsmith/wrappers", () => ({
  wrapOpenAI: (client: unknown) => client,
}));

const mockDbQuery = jest.fn();
const mockDb = { query: mockDbQuery } as unknown as Pool;

describe("Dashboard Queries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getCollaborationStats", () => {
    it("returns collaboration counts", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ open: "5", target: "3", pending: "2", active: "6" }],
      });

      const stats = await getCollaborationStats(mockDb);
      expect(stats.open).toBe(5);
      expect(stats.target).toBe(3);
      expect(stats.pending).toBe(2);
      expect(stats.active).toBe(6);
    });
  });

  describe("getActiveCollaborations", () => {
    it("returns collaboration rows", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            collaboration_id: "collab-001",
            type: "target",
            creator_id: "creator-1",
            product_ids: ["prod-1"],
            commission_config: { type: "flat", flatRate: 15 },
            sample_type: "free_auto_approve",
            status: "active",
            match_score: 85.5,
            created_at: "2026-02-01",
          },
        ],
      });

      const collabs = await getActiveCollaborations(mockDb);
      expect(collabs).toHaveLength(1);
      expect(collabs[0].type).toBe("target");
      expect(collabs[0].commissionConfig.flatRate).toBe(15);
    });
  });

  describe("getOrderStats", () => {
    it("returns order counts", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ total: "10", pending: "3", delivered: "5", cancelled: "2" }],
      });

      const stats = await getOrderStats(mockDb);
      expect(stats.total).toBe(10);
      expect(stats.delivered).toBe(5);
    });
  });

  describe("getPendingBriefs", () => {
    it("returns pending approval briefs", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            brief_id: "brief-001",
            trend_data: { hookType: "Morning Routine" },
            product_data: { productName: "Vitamin D" },
            regulatory_check: { passed: true },
            creative_guards: { approvedHashtags: ["#wellness"] },
            brief_text: "Test brief",
            approval_status: "pending_approval",
            target_creator_ids: ["creator-1"],
            owner_notes: null,
            created_at: "2026-02-01",
          },
        ],
      });

      const briefs = await getPendingBriefs(mockDb);
      expect(briefs).toHaveLength(1);
      expect(briefs[0].approvalStatus).toBe("pending_approval");
    });
  });

  describe("updateBriefStatus", () => {
    it("updates brief approval status", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await updateBriefStatus(mockDb, "brief-001", "approved");

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("approval_status = $1"),
        ["approved", null, "brief-001"]
      );
    });
  });
});

describe("HITL Review Queue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getPendingReviews", () => {
    it("returns pending review items", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            review_id: "rev-001",
            content_text: "This supplement cures colds",
            retrieved_chunks: [{ text: "Rule 15.6.2" }],
            judge_verdict: {
              prohibitedTerms: { pass: false, termsFound: ["cures"] },
            },
            confidence_score: "45",
            triggered_rules: ["15.6.2"],
            decision: "pending",
            reviewer_notes: null,
            created_at: "2026-02-01",
            decided_at: null,
          },
        ],
      });

      const reviews = await getPendingReviews(mockDb);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].confidenceScore).toBe(45);
      expect(reviews[0].triggeredRules).toContain("15.6.2");
    });
  });

  describe("insertReview", () => {
    it("inserts a review queue item", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await insertReview(mockDb, {
        reviewId: "rev-002",
        contentText: "Lose 5kg in 2 weeks",
        retrievedChunks: [],
        judgeVerdict: { dosageAccuracy: { pass: false } },
        confidenceScore: 30,
        triggeredRules: ["15.6.6"],
      });

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO review_queue"),
        expect.arrayContaining(["rev-002", "Lose 5kg in 2 weeks"])
      );
    });
  });

  describe("updateReviewDecision", () => {
    it("records approve decision", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await updateReviewDecision(mockDb, "rev-001", "approved");

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("decision = $1"),
        ["approved", null, "rev-001"]
      );
    });

    it("records reject decision with notes", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await updateReviewDecision(
        mockDb,
        "rev-001",
        "rejected",
        "Medicinal claim detected"
      );

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("decision = $1"),
        ["rejected", "Medicinal claim detected", "rev-001"]
      );
    });
  });
});

describe("Agent Activity Feed", () => {
  beforeEach(() => jest.clearAllMocks());

  it("logs activity events", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await logActivity(mockDb, "creator_search", { results: 10 });

    expect(mockDbQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_activity_log"),
      ["creator_search", '{"results":10}', "completed"]
    );
  });

  it("retrieves recent activity", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          action_type: "creator_search",
          details: { results: 10 },
          status: "completed",
          created_at: "2026-02-01",
        },
      ],
    });

    const activities = await getRecentActivity(mockDb);
    expect(activities).toHaveLength(1);
    expect(activities[0].actionType).toBe("creator_search");
  });
});

describe("GDPR Manual Erasure", () => {
  beforeEach(() => jest.clearAllMocks());

  it("erases PII across all tables", async () => {
    // Orders
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
    // Creators
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    const result = await eraseAllPiiForSubject(mockDb, "test-subject");

    expect(result.tablesAffected).toContain("orders");
    expect(result.tablesAffected).toContain("creators");
    expect(result.rowsDeleted).toBe(2);
  });

  it("handles subject with no data gracefully", async () => {
    mockDbQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await eraseAllPiiForSubject(mockDb, "nonexistent");

    expect(result.tablesAffected).toHaveLength(0);
    expect(result.rowsDeleted).toBe(0);
  });
});

describe("Threshold Tuner", () => {
  beforeEach(() => jest.clearAllMocks());

  it("maintains 95% with no data", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const tuner = new ThresholdTuner(mockDb);
    const analysis = await tuner.analyze();

    expect(analysis.recommendedThreshold).toBe(95);
    expect(analysis.rationale).toContain("Insufficient");
  });

  it("validates threshold range", () => {
    const tuner = new ThresholdTuner(mockDb);
    expect(() => tuner.setThreshold(49)).toThrow("between 50 and 100");
    expect(() => tuner.setThreshold(101)).toThrow("between 50 and 100");
    tuner.setThreshold(90);
    expect(tuner.getThreshold()).toBe(90);
  });
});
