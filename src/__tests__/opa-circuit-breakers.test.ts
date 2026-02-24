/**
 * OPA Circuit Breakers — Tests
 *
 * Tests:
 * - Velocity breaker: £50+ in 10 min → all activity halts
 * - Commission cap: proposed deal exceeding cap → blocked
 * - Loop detector: 10 identical calls without progress → auto-terminate
 * - Guard: non-bypassable enforcement
 * - Policy evaluation combines all checks
 */

import { OPAPolicyEngine, setOPAAlert } from "@/lib/opa/policy-engine";
import { OPAPolicyGuard, PolicyDeniedError } from "@/lib/opa/guard";
import { ProfitabilityEngine } from "@/lib/profitability/engine";
import { Pool } from "pg";

// ─── Mocks ───

jest.mock("langsmith/traceable", () => ({
  traceable: jest.fn((fn) => fn),
}));

jest.mock("langsmith/wrappers", () => ({
  wrapOpenAI: (client: unknown) => client,
}));

const mockDbQuery = jest.fn();
const mockDb = { query: mockDbQuery } as unknown as Pool;

const mockOPAAlert = jest.fn();

// ─── Tests ───

describe("OPA Policy Engine", () => {
  let profitabilityEngine: ProfitabilityEngine;
  let engine: OPAPolicyEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    profitabilityEngine = new ProfitabilityEngine(mockDb);
    engine = new OPAPolicyEngine(mockDb, profitabilityEngine, {
      velocityMaxSpendGBP: 50,
      velocityWindowMs: 10 * 60 * 1000,
      loopMaxRepetitions: 10,
      loopWindowMs: 5 * 60 * 1000,
    });
    setOPAAlert(mockOPAAlert);
  });

  // ─── Velocity Monitor ───

  describe("Velocity Monitor", () => {
    it("allows activity when spend is below threshold", async () => {
      // Record £10 in spend
      engine.recordLLMCost({
        timestamp: new Date(),
        modelId: "claude-haiku",
        costGBP: 10,
        taskType: "compliance",
      });

      const result = await engine.evaluate({
        actionType: "llm_call",
        estimatedCostGBP: 5,
        modelId: "gpt-5.1",
        taskType: "outreach",
      });

      expect(result.allowed).toBe(true);
    });

    it("halts ALL activity when £50+ spent in 10 minutes", async () => {
      // Simulate rapid spending
      for (let i = 0; i < 10; i++) {
        engine.recordLLMCost({
          timestamp: new Date(),
          modelId: "claude-haiku",
          costGBP: 6,
          taskType: "compliance",
        });
      }
      // Total: £60 in the window

      const result = await engine.evaluate({
        actionType: "llm_call",
        estimatedCostGBP: 0.01,
      });

      expect(result.allowed).toBe(false);
      expect(result.deniedBy).toBe("velocity_monitor");
      expect(engine.isHalted()).toBe(true);
    });

    it("denies all action types when halted", async () => {
      // Force halt
      for (let i = 0; i < 10; i++) {
        engine.recordLLMCost({
          timestamp: new Date(),
          modelId: "test",
          costGBP: 6,
          taskType: "test",
        });
      }
      // Trigger the halt
      await engine.evaluate({ actionType: "llm_call" });

      // Now ALL actions should be denied
      const msgResult = await engine.evaluate({ actionType: "message_send" });
      expect(msgResult.allowed).toBe(false);
      expect(msgResult.deniedBy).toBe("velocity_monitor");

      const apiResult = await engine.evaluate({ actionType: "api_call" });
      expect(apiResult.allowed).toBe(false);

      const collabResult = await engine.evaluate({
        actionType: "collaboration_create",
      });
      expect(collabResult.allowed).toBe(false);
    });

    it("alerts admin when velocity breaker triggers", async () => {
      for (let i = 0; i < 10; i++) {
        engine.recordLLMCost({
          timestamp: new Date(),
          modelId: "test",
          costGBP: 6,
          taskType: "test",
        });
      }

      await engine.evaluate({ actionType: "llm_call" });

      expect(mockOPAAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "critical",
          breaker: "velocity_monitor",
        })
      );
    });

    it("can be manually reset by admin", async () => {
      // Trigger halt
      for (let i = 0; i < 10; i++) {
        engine.recordLLMCost({
          timestamp: new Date(),
          modelId: "test",
          costGBP: 6,
          taskType: "test",
        });
      }
      await engine.evaluate({ actionType: "llm_call" });
      expect(engine.isHalted()).toBe(true);

      // Reset
      engine.resetVelocityBreaker();
      expect(engine.isHalted()).toBe(false);

      // Should allow again
      const result = await engine.evaluate({ actionType: "llm_call" });
      expect(result.allowed).toBe(true);
    });

    it("prunes old cost records outside the window", async () => {
      // Record old cost (outside window)
      engine.recordLLMCost({
        timestamp: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
        modelId: "test",
        costGBP: 100,
        taskType: "test",
      });

      // This should NOT trigger the breaker
      const result = await engine.evaluate({
        actionType: "llm_call",
        estimatedCostGBP: 1,
      });

      expect(result.allowed).toBe(true);
      expect(engine.getWindowSpend()).toBeLessThan(50);
    });
  });

  // ─── Commission Cap ───

  describe("Commission Cap", () => {
    it("blocks collaboration when commission exceeds cap", async () => {
      // Mock DB: product with tight margins
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            product_sku: "VIT-D-001",
            commission_tier: "15",
            cogs: "15.00",
            net_margin: "3.00",
            velocity_limit: "500",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await engine.evaluate({
        actionType: "collaboration_create",
        productSku: "VIT-D-001",
        salePrice: 25.0,
        proposedCommissionPercent: 30, // 30% of £25 = £7.50
        // Max: £25 - £15 - £4.50 - £3.00 - £3.00 = -£0.50 → cap at 0
      });

      expect(result.allowed).toBe(false);
      expect(result.deniedBy).toBe("commission_cap");
    });

    it("allows collaboration when commission is within cap", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            product_sku: "VIT-D-001",
            commission_tier: "15",
            cogs: "3.50",
            net_margin: "2.00",
            velocity_limit: "500",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await engine.evaluate({
        actionType: "collaboration_create",
        productSku: "VIT-D-001",
        salePrice: 25.0,
        proposedCommissionPercent: 10,
      });

      expect(result.allowed).toBe(true);
    });

    it("denies when profitability data is missing (safety measure)", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const result = await engine.evaluate({
        actionType: "collaboration_create",
        productSku: "UNKNOWN",
        salePrice: 25.0,
        proposedCommissionPercent: 10,
      });

      expect(result.allowed).toBe(false);
      expect(result.deniedBy).toBe("commission_cap");
    });

    it("applies to mcf_order action type too", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            product_sku: "VIT-D-001",
            commission_tier: "15",
            cogs: "3.50",
            net_margin: "2.00",
            velocity_limit: "500",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await engine.evaluate({
        actionType: "mcf_order",
        productSku: "VIT-D-001",
        salePrice: 25.0,
        proposedCommissionPercent: 10,
      });

      expect(result.allowed).toBe(true);
    });
  });

  // ─── Loop Detector ───

  describe("Loop Detector", () => {
    it("allows calls that make progress", async () => {
      for (let i = 0; i < 15; i++) {
        const result = await engine.evaluate({
          actionType: "api_call",
          callKey: "searchCreators",
          madeProgress: true,
        });
        expect(result.allowed).toBe(true);
      }
    });

    it("auto-terminates after 10 identical calls without progress", async () => {
      let lastResult;
      for (let i = 0; i < 10; i++) {
        lastResult = await engine.evaluate({
          actionType: "api_call",
          callKey: "searchCreators",
          madeProgress: false,
        });
      }

      expect(lastResult!.allowed).toBe(false);
      expect(lastResult!.deniedBy).toBe("loop_detector");
    });

    it("resets loop count when progress is made", async () => {
      // 9 calls without progress
      for (let i = 0; i < 9; i++) {
        await engine.evaluate({
          actionType: "api_call",
          callKey: "searchCreators",
          madeProgress: false,
        });
      }

      // Make progress
      await engine.evaluate({
        actionType: "api_call",
        callKey: "searchCreators",
        madeProgress: true,
      });

      // 9 more without progress — should still be allowed
      for (let i = 0; i < 9; i++) {
        const result = await engine.evaluate({
          actionType: "api_call",
          callKey: "searchCreators",
          madeProgress: false,
        });
        expect(result.allowed).toBe(true);
      }
    });

    it("tracks different call keys independently", async () => {
      // 10 calls on key A without progress
      for (let i = 0; i < 10; i++) {
        await engine.evaluate({
          actionType: "api_call",
          callKey: "keyA",
          madeProgress: false,
        });
      }

      // Key B should still be allowed
      const result = await engine.evaluate({
        actionType: "api_call",
        callKey: "keyB",
        madeProgress: false,
      });
      expect(result.allowed).toBe(true);
    });

    it("can clear loop records", async () => {
      for (let i = 0; i < 9; i++) {
        await engine.evaluate({
          actionType: "api_call",
          callKey: "searchCreators",
          madeProgress: false,
        });
      }

      engine.clearLoopRecords("searchCreators");

      const result = await engine.evaluate({
        actionType: "api_call",
        callKey: "searchCreators",
        madeProgress: false,
      });
      expect(result.allowed).toBe(true);
    });
  });

  // ─── Combined Policy Evaluation ───

  describe("Combined Evaluation", () => {
    it("checks velocity + commission for collaboration_create", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            product_sku: "VIT-D-001",
            commission_tier: "15",
            cogs: "3.50",
            net_margin: "2.00",
            velocity_limit: "500",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await engine.evaluate({
        actionType: "collaboration_create",
        productSku: "VIT-D-001",
        salePrice: 25.0,
        proposedCommissionPercent: 10,
      });

      // Should have results for both velocity and commission checks
      expect(result.results.length).toBe(2);
      expect(result.results[0].checkType).toBe("velocity_monitor");
      expect(result.results[1].checkType).toBe("commission_cap");
      expect(result.allowed).toBe(true);
    });

    it("checks velocity + loop for api_call", async () => {
      const result = await engine.evaluate({
        actionType: "api_call",
        callKey: "testCall",
        madeProgress: true,
      });

      expect(result.results.length).toBe(2);
      expect(result.results[0].checkType).toBe("velocity_monitor");
      expect(result.results[1].checkType).toBe("loop_detector");
    });

    it("checks only velocity for message_send", async () => {
      const result = await engine.evaluate({
        actionType: "message_send",
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].checkType).toBe("velocity_monitor");
    });
  });
});

// ─── OPA Policy Guard ───

describe("OPAPolicyGuard", () => {
  let profitabilityEngine: ProfitabilityEngine;
  let engine: OPAPolicyEngine;
  let guard: OPAPolicyGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    profitabilityEngine = new ProfitabilityEngine(mockDb);
    engine = new OPAPolicyEngine(mockDb, profitabilityEngine);
    guard = new OPAPolicyGuard(engine);
    setOPAAlert(jest.fn());
  });

  it("allows valid LLM calls", async () => {
    const result = await guard.checkLLMCall(0.01, "claude-haiku", "compliance");
    expect(result.allowed).toBe(true);
  });

  it("throws PolicyDeniedError when policy denies", async () => {
    // Trigger halt
    for (let i = 0; i < 10; i++) {
      engine.recordLLMCost({
        timestamp: new Date(),
        modelId: "test",
        costGBP: 6,
        taskType: "test",
      });
    }
    await engine.evaluate({ actionType: "llm_call" });

    await expect(
      guard.checkLLMCall(0.01, "test", "test")
    ).rejects.toThrow(PolicyDeniedError);
  });

  it("PolicyDeniedError contains evaluation details", async () => {
    for (let i = 0; i < 10; i++) {
      engine.recordLLMCost({
        timestamp: new Date(),
        modelId: "test",
        costGBP: 6,
        taskType: "test",
      });
    }
    await engine.evaluate({ actionType: "llm_call" });

    try {
      await guard.checkLLMCall(0.01, "test", "test");
      fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyDeniedError);
      const policyErr = err as PolicyDeniedError;
      expect(policyErr.evaluation.deniedBy).toBe("velocity_monitor");
      expect(policyErr.context.actionType).toBe("llm_call");
    }
  });

  it("evaluateOnly does not throw on denial", async () => {
    for (let i = 0; i < 10; i++) {
      engine.recordLLMCost({
        timestamp: new Date(),
        modelId: "test",
        costGBP: 6,
        taskType: "test",
      });
    }
    await engine.evaluate({ actionType: "llm_call" });

    const result = await guard.evaluateOnly({ actionType: "llm_call" });
    expect(result.allowed).toBe(false);
  });

  it("isHalted reflects engine state", async () => {
    expect(guard.isHalted()).toBe(false);

    for (let i = 0; i < 10; i++) {
      engine.recordLLMCost({
        timestamp: new Date(),
        modelId: "test",
        costGBP: 6,
        taskType: "test",
      });
    }
    await engine.evaluate({ actionType: "llm_call" });

    expect(guard.isHalted()).toBe(true);
  });

  it("checkCollaboration validates commission", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          product_sku: "VIT-D-001",
          commission_tier: "15",
          cogs: "3.50",
          net_margin: "2.00",
          velocity_limit: "500",
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
    });

    const result = await guard.checkCollaboration("VIT-D-001", 25.0, 10);
    expect(result.allowed).toBe(true);
  });

  it("checkAPICall validates loop detection", async () => {
    const result = await guard.checkAPICall("testCall", true);
    expect(result.allowed).toBe(true);
  });
});
