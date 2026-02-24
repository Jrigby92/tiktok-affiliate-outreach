/**
 * Profitability Engine
 *
 * Calculates dynamic commission cap per product:
 *   Max commission = Sale price - COGS - Amazon MCF fees - TikTok platform fees - required net margin
 *
 * TikTok UK platform fees breakdown:
 *   - 9% commission on total order value (category-specific, some 5%)
 *   - £0.50 "Shipped by Seller" fee per order
 *   - ~20-30p payment processing fee per transaction
 *
 * All calculations use live data from the `profitability` table.
 * MCF fees from `getFulfillmentPreview` or configured lookup.
 */

import { Pool } from "pg";
import { traced } from "@/lib/llm/langsmith";
import {
  ProductProfitability,
  CommissionCapResult,
  AmazonMCFFees,
  ProfitabilityConfig,
  DEFAULT_PROFITABILITY_CONFIG,
} from "./types";

export class ProfitabilityEngine {
  private db: Pool;
  private config: ProfitabilityConfig;

  constructor(db: Pool, config?: Partial<ProfitabilityConfig>) {
    this.db = db;
    this.config = { ...DEFAULT_PROFITABILITY_CONFIG, ...config };
  }

  /**
   * Calculate the maximum commission for a product at a given sale price.
   * Uses live data from the profitability table.
   */
  async calculateCommissionCap(
    productSku: string,
    salePrice: number,
    options?: {
      /** Override MCF fees with actual preview data */
      mcfFees?: AmazonMCFFees;
      /** Product category for TikTok rate lookup */
      category?: string;
      /** Proposed commission percentage for comparison */
      proposedCommissionPercent?: number;
    }
  ): Promise<CommissionCapResult> {
    const tracedCalc = traced(
      async (): Promise<CommissionCapResult> => {
        // Fetch live profitability data
        const profitability = await this.getProductProfitability(productSku);
        if (!profitability) {
          throw new Error(
            `No profitability data found for SKU: ${productSku}`
          );
        }

        return this.computeCommissionCap(
          profitability,
          salePrice,
          options?.mcfFees,
          options?.category,
          options?.proposedCommissionPercent
        );
      },
      {
        name: "profitability-commission-cap",
        runType: "tool",
        metadata: { productSku, salePrice },
      }
    );

    return tracedCalc();
  }

  /**
   * Pure computation of commission cap (no DB call).
   * Useful for testing and batch calculations.
   */
  computeCommissionCap(
    profitability: ProductProfitability,
    salePrice: number,
    mcfFees?: AmazonMCFFees,
    category?: string,
    proposedCommissionPercent?: number
  ): CommissionCapResult {
    const cogs = profitability.cogs;
    const requiredNetMargin = profitability.netMargin;

    // Amazon MCF fees
    const amazonFees = mcfFees || this.config.defaultMCFFees;
    const amazonMCFFees = amazonFees.total;

    // TikTok platform fees
    const categoryRate =
      this.config.categoryRates[category || "default"] ||
      this.config.tiktokFees.commissionRate;
    const tiktokCommission = salePrice * categoryRate;
    const shippedBySellerFee = this.config.tiktokFees.shippedBySellerFee;
    const paymentProcessingFee = this.config.tiktokFees.paymentProcessingFee;
    const tiktokPlatformFees =
      tiktokCommission + shippedBySellerFee + paymentProcessingFee;

    // Max commission = Sale price - COGS - MCF fees - TikTok fees - required margin
    const maxCommissionGBP = Math.max(
      0,
      salePrice - cogs - amazonMCFFees - tiktokPlatformFees - requiredNetMargin
    );

    const maxCommissionPercent =
      salePrice > 0
        ? Math.round((maxCommissionGBP / salePrice) * 10000) / 100
        : 0;

    // Check proposed commission
    const proposedCommissionGBP =
      proposedCommissionPercent !== undefined
        ? salePrice * (proposedCommissionPercent / 100)
        : undefined;

    const isProfitable =
      proposedCommissionGBP !== undefined
        ? proposedCommissionGBP <= maxCommissionGBP
        : maxCommissionGBP > 0;

    return {
      productSku: profitability.productSku,
      salePrice,
      cogs,
      amazonMCFFees,
      tiktokPlatformFees: Math.round(tiktokPlatformFees * 100) / 100,
      tiktokFeesBreakdown: {
        tiktokCommission: Math.round(tiktokCommission * 100) / 100,
        shippedBySellerFee,
        paymentProcessingFee,
      },
      requiredNetMargin,
      maxCommissionGBP: Math.round(maxCommissionGBP * 100) / 100,
      maxCommissionPercent,
      isProfitable,
      proposedCommissionGBP:
        proposedCommissionGBP !== undefined
          ? Math.round(proposedCommissionGBP * 100) / 100
          : undefined,
    };
  }

  /**
   * Check if a proposed commission rate is within the profitable range.
   */
  async isCommissionProfitable(
    productSku: string,
    salePrice: number,
    proposedCommissionPercent: number,
    options?: {
      mcfFees?: AmazonMCFFees;
      category?: string;
    }
  ): Promise<{ allowed: boolean; cap: CommissionCapResult }> {
    const cap = await this.calculateCommissionCap(productSku, salePrice, {
      ...options,
      proposedCommissionPercent,
    });

    return {
      allowed: cap.isProfitable,
      cap,
    };
  }

  /**
   * Fetch product profitability data from the database.
   */
  async getProductProfitability(
    productSku: string
  ): Promise<ProductProfitability | null> {
    const result = await this.db.query(
      `SELECT id, product_sku, commission_tier, cogs, net_margin, velocity_limit,
              created_at, updated_at
       FROM profitability
       WHERE product_sku = $1
       LIMIT 1`,
      [productSku]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      productSku: row.product_sku,
      commissionTier: parseFloat(row.commission_tier),
      cogs: parseFloat(row.cogs),
      netMargin: parseFloat(row.net_margin),
      velocityLimit: parseFloat(row.velocity_limit),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Upsert product profitability data.
   */
  async upsertProductProfitability(
    data: Omit<ProductProfitability, "id" | "createdAt" | "updatedAt">
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO profitability (product_sku, commission_tier, cogs, net_margin, velocity_limit)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (product_sku) DO UPDATE SET
         commission_tier = EXCLUDED.commission_tier,
         cogs = EXCLUDED.cogs,
         net_margin = EXCLUDED.net_margin,
         velocity_limit = EXCLUDED.velocity_limit`,
      [
        data.productSku,
        data.commissionTier,
        data.cogs,
        data.netMargin,
        data.velocityLimit,
      ]
    );
  }

  /**
   * Get all product profitability records.
   */
  async getAllProductProfitability(): Promise<ProductProfitability[]> {
    const result = await this.db.query(
      `SELECT id, product_sku, commission_tier, cogs, net_margin, velocity_limit,
              created_at, updated_at
       FROM profitability
       ORDER BY product_sku`
    );

    return result.rows.map((row) => ({
      id: row.id,
      productSku: row.product_sku,
      commissionTier: parseFloat(row.commission_tier),
      cogs: parseFloat(row.cogs),
      netMargin: parseFloat(row.net_margin),
      velocityLimit: parseFloat(row.velocity_limit),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** Expose config for testing */
  getConfig(): Readonly<ProfitabilityConfig> {
    return { ...this.config };
  }
}
