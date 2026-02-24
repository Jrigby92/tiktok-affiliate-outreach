/**
 * Creator types for the discovery and match-making modules.
 */

import type { CreatorSearchFilters, CreatorProfile } from "@/lib/api/tiktok/types";

export interface StoredCreator {
  id: number;
  handle: string;
  followerCount: number;
  engagementMetrics: Record<string, unknown>;
  nicheTags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductCatalogEntry {
  productId: string;
  name: string;
  sku: string;
  category: string;
  targetAudience: {
    countries?: string[];
    ageRange?: [number, number] | string[];
    gender?: string | string[];
    interests: string[];
  };
  nicheTags: string[];
  price?: number;
}

export interface CreatorProductMatch {
  creatorId: string;
  creatorHandle?: string;
  productId: string;
  productName?: string;
  matchScore: number;
  scoreBreakdown: {
    nicheAlignment: number;
    engagementQuality: number;
    audienceOverlap: number;
    conversionPotential: number;
  };
  rank?: number;
}

export interface MatchWeights {
  nicheAlignment: number;
  engagementQuality: number;
  audienceOverlap: number;
  conversionPotential: number;
}

export interface DiscoveryRunConfig {
  filters?: Partial<CreatorSearchFilters>;
  maxResults?: number;
  persistResults?: boolean;
}

export interface DiscoveryRunResult {
  creators: CreatorProfile[];
  newCreators: number;
  updatedCreators: number;
  totalInDb: number;
  timestamp: Date;
}
