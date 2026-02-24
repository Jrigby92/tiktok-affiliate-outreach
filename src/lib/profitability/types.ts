/**
 * Profitability Engine Types
 *
 * Dynamic commission cap calculation per product:
 * Max commission = Sale price - COGS - Amazon MCF fees - TikTok platform fees - required net margin
 */

/**
 * Product profitability record from the `profitability` table.
 */
export interface ProductProfitability {
  id: number;
  productSku: string;
  /** Current commission tier (percentage, e.g. 15 = 15%) */
  commissionTier: number;
  /** Cost of goods sold in GBP */
  cogs: number;
  /** Required net margin in GBP */
  netMargin: number;
  /** Max spend rate per period in GBP */
  velocityLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * TikTok UK platform fee breakdown.
 */
export interface TikTokFees {
  /** Commission rate on total order value (default: 0.09 = 9%) */
  commissionRate: number;
  /** "Shipped by Seller" fee per order in GBP (default: £0.50) */
  shippedBySellerFee: number;
  /** Payment processing fee per transaction in GBP (default: £0.25, range 20–30p) */
  paymentProcessingFee: number;
}

/**
 * Amazon MCF fees for a specific fulfillment preview.
 */
export interface AmazonMCFFees {
  /** Fulfillment fee in GBP */
  fulfillmentFee: number;
  /** Per-item handling fee in GBP */
  perItemFee: number;
  /** Weight handling fee in GBP */
  weightHandlingFee: number;
  /** Total MCF fees in GBP */
  total: number;
}

/**
 * Full commission cap calculation result.
 */
export interface CommissionCapResult {
  productSku: string;
  /** Sale price in GBP */
  salePrice: number;
  /** Cost of goods sold in GBP */
  cogs: number;
  /** Amazon MCF fees in GBP */
  amazonMCFFees: number;
  /** TikTok platform fees in GBP (commission + per-order + processing) */
  tiktokPlatformFees: number;
  /** TikTok fees breakdown */
  tiktokFeesBreakdown: {
    tiktokCommission: number;
    shippedBySellerFee: number;
    paymentProcessingFee: number;
  };
  /** Required net margin in GBP */
  requiredNetMargin: number;
  /** Maximum commission in GBP */
  maxCommissionGBP: number;
  /** Maximum commission as percentage of sale price */
  maxCommissionPercent: number;
  /** Whether the product is profitable at the proposed commission */
  isProfitable: boolean;
  /** Proposed commission in GBP (for comparison) */
  proposedCommissionGBP?: number;
}

/**
 * Default TikTok UK platform fees (as of Jan 2026).
 */
export const DEFAULT_TIKTOK_FEES: TikTokFees = {
  commissionRate: 0.09, // 9% standard rate
  shippedBySellerFee: 0.50, // £0.50 per order
  paymentProcessingFee: 0.25, // ~20–30p, use 25p as midpoint
};

/**
 * Category-specific TikTok commission rates.
 * Some sub-categories have lower rates.
 */
export const TIKTOK_CATEGORY_RATES: Record<string, number> = {
  default: 0.09,
  electronics: 0.05,
  beauty: 0.05,
  supplements: 0.09,
  health_wellness: 0.09,
  fitness: 0.09,
};

/**
 * Default Amazon MCF fee estimate when preview is unavailable.
 */
export const DEFAULT_MCF_FEES: AmazonMCFFees = {
  fulfillmentFee: 3.25,
  perItemFee: 0.50,
  weightHandlingFee: 0.75,
  total: 4.50,
};

/**
 * Configuration for the profitability engine.
 */
export interface ProfitabilityConfig {
  /** Default TikTok fee config */
  tiktokFees: TikTokFees;
  /** Default MCF fee estimate (used when preview unavailable) */
  defaultMCFFees: AmazonMCFFees;
  /** Category-specific TikTok commission rates */
  categoryRates: Record<string, number>;
}

export const DEFAULT_PROFITABILITY_CONFIG: ProfitabilityConfig = {
  tiktokFees: DEFAULT_TIKTOK_FEES,
  defaultMCFFees: DEFAULT_MCF_FEES,
  categoryRates: TIKTOK_CATEGORY_RATES,
};
