/**
 * Profitability Engine & Commission Cap Tests
 *
 * Tests:
 * - Commission cap formula correctness for known inputs
 * - TikTok fee breakdown (9% + £0.50 + payment processing)
 * - Category-specific TikTok rates (5% for some, 9% for supplements)
 * - Profitability check: profitable vs unprofitable deals
 * - Database CRUD for profitability records
 */

import { ProfitabilityEngine } from "@/lib/profitability/engine";
import {
  ProductProfitability,
  DEFAULT_TIKTOK_FEES,
  DEFAULT_MCF_FEES,
} from "@/lib/profitability/types";
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

// ─── Test Data ───

const TEST_PROFITABILITY: ProductProfitability = {
  id: 1,
  productSku: "VIT-D-001",
  commissionTier: 15,
  cogs: 3.5,
  netMargin: 2.0,
  velocityLimit: 500,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Tests ───

describe("ProfitabilityEngine", () => {
  let engine: ProfitabilityEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new ProfitabilityEngine(mockDb);
  });

  describe("computeCommissionCap", () => {
    it("calculates max commission correctly for known inputs", () => {
      // Sale price: £25.00
      // COGS: £3.50
      // MCF fees: £4.50 (default)
      // TikTok fees: 9% of £25 = £2.25 + £0.50 + £0.25 = £3.00
      // Required margin: £2.00
      // Max commission = £25 - £3.50 - £4.50 - £3.00 - £2.00 = £12.00
      const result = engine.computeCommissionCap(TEST_PROFITABILITY, 25.0);

      expect(result.productSku).toBe("VIT-D-001");
      expect(result.salePrice).toBe(25.0);
      expect(result.cogs).toBe(3.5);
      expect(result.amazonMCFFees).toBe(4.5);
      expect(result.tiktokFeesBreakdown.tiktokCommission).toBe(2.25);
      expect(result.tiktokFeesBreakdown.shippedBySellerFee).toBe(0.5);
      expect(result.tiktokFeesBreakdown.paymentProcessingFee).toBe(0.25);
      expect(result.tiktokPlatformFees).toBe(3.0);
      expect(result.requiredNetMargin).toBe(2.0);
      expect(result.maxCommissionGBP).toBe(12.0);
      expect(result.maxCommissionPercent).toBe(48.0);
      expect(result.isProfitable).toBe(true);
    });

    it("caps at zero when costs exceed sale price", () => {
      const expensiveProduct: ProductProfitability = {
        ...TEST_PROFITABILITY,
        cogs: 20.0, // high COGS
        netMargin: 5.0,
      };

      // Sale price: £10.00
      // COGS: £20.00 — already exceeds sale price
      const result = engine.computeCommissionCap(expensiveProduct, 10.0);

      expect(result.maxCommissionGBP).toBe(0);
      expect(result.maxCommissionPercent).toBe(0);
      expect(result.isProfitable).toBe(false);
    });

    it("correctly marks proposed commission as unprofitable when exceeding cap", () => {
      const result = engine.computeCommissionCap(
        TEST_PROFITABILITY,
        25.0,
        undefined,
        undefined,
        60 // 60% proposed = £15, exceeds £12 cap
      );

      expect(result.isProfitable).toBe(false);
      expect(result.proposedCommissionGBP).toBe(15.0);
      expect(result.maxCommissionGBP).toBe(12.0);
    });

    it("correctly marks proposed commission as profitable when within cap", () => {
      const result = engine.computeCommissionCap(
        TEST_PROFITABILITY,
        25.0,
        undefined,
        undefined,
        10 // 10% proposed = £2.50, within £12 cap
      );

      expect(result.isProfitable).toBe(true);
      expect(result.proposedCommissionGBP).toBe(2.5);
    });

    it("uses category-specific TikTok rates", () => {
      // Electronics category: 5% instead of 9%
      const electronicsEngine = new ProfitabilityEngine(mockDb, {
        categoryRates: { electronics: 0.05, default: 0.09 },
      });

      const result = electronicsEngine.computeCommissionCap(
        TEST_PROFITABILITY,
        25.0,
        undefined,
        "electronics"
      );

      // TikTok commission: 5% of £25 = £1.25
      expect(result.tiktokFeesBreakdown.tiktokCommission).toBe(1.25);
      // Total TikTok fees: £1.25 + £0.50 + £0.25 = £2.00
      expect(result.tiktokPlatformFees).toBe(2.0);
      // More room for commission: £25 - £3.50 - £4.50 - £2.00 - £2.00 = £13.00
      expect(result.maxCommissionGBP).toBe(13.0);
    });

    it("uses custom MCF fees from preview", () => {
      const customMCF = {
        fulfillmentFee: 5.0,
        perItemFee: 1.0,
        weightHandlingFee: 1.0,
        total: 7.0,
      };

      const result = engine.computeCommissionCap(
        TEST_PROFITABILITY,
        25.0,
        customMCF
      );

      expect(result.amazonMCFFees).toBe(7.0);
      // Max commission = £25 - £3.50 - £7.00 - £3.00 - £2.00 = £9.50
      expect(result.maxCommissionGBP).toBe(9.5);
    });

    it("handles zero sale price gracefully", () => {
      const result = engine.computeCommissionCap(TEST_PROFITABILITY, 0);

      expect(result.maxCommissionGBP).toBe(0);
      expect(result.maxCommissionPercent).toBe(0);
    });
  });

  describe("calculateCommissionCap (with DB)", () => {
    it("fetches profitability from DB and calculates cap", async () => {
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

      const result = await engine.calculateCommissionCap("VIT-D-001", 25.0);

      expect(result.maxCommissionGBP).toBe(12.0);
      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("FROM profitability"),
        ["VIT-D-001"]
      );
    });

    it("throws when no profitability data found", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        engine.calculateCommissionCap("UNKNOWN-SKU", 25.0)
      ).rejects.toThrow("No profitability data found for SKU: UNKNOWN-SKU");
    });
  });

  describe("isCommissionProfitable", () => {
    it("returns allowed=true for profitable commission", async () => {
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

      const { allowed, cap } = await engine.isCommissionProfitable(
        "VIT-D-001",
        25.0,
        10
      );

      expect(allowed).toBe(true);
      expect(cap.maxCommissionPercent).toBe(48.0);
    });

    it("returns allowed=false for unprofitable commission", async () => {
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

      const { allowed } = await engine.isCommissionProfitable(
        "VIT-D-001",
        25.0,
        60 // 60% exceeds 48% cap
      );

      expect(allowed).toBe(false);
    });
  });

  describe("DB operations", () => {
    it("upserts profitability data", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await engine.upsertProductProfitability({
        productSku: "VIT-D-001",
        commissionTier: 15,
        cogs: 3.5,
        netMargin: 2.0,
        velocityLimit: 500,
      });

      expect(mockDbQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO profitability"),
        ["VIT-D-001", 15, 3.5, 2.0, 500]
      );
    });

    it("fetches all profitability records", async () => {
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

      const records = await engine.getAllProductProfitability();
      expect(records).toHaveLength(1);
      expect(records[0].productSku).toBe("VIT-D-001");
    });
  });

  describe("default fee constants", () => {
    it("has correct default TikTok fees", () => {
      expect(DEFAULT_TIKTOK_FEES.commissionRate).toBe(0.09);
      expect(DEFAULT_TIKTOK_FEES.shippedBySellerFee).toBe(0.5);
      expect(DEFAULT_TIKTOK_FEES.paymentProcessingFee).toBe(0.25);
    });

    it("has correct default MCF fees", () => {
      expect(DEFAULT_MCF_FEES.total).toBe(4.5);
    });
  });
});
