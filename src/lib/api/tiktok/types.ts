// ============================================================
// TikTok Affiliate Seller API — TypeScript Type Definitions
// ============================================================

// --- Creator Search ---

export interface CreatorSearchFilters {
  /** Minimum follower count (default: 5000 for UK market) */
  minFollowers?: number;
  /** Maximum number of account violations (default: 3) */
  maxViolations?: number;
  /** Demographic filters */
  demographics?: {
    country?: string;
    ageRange?: { min: number; max: number };
    gender?: "male" | "female" | "all";
  };
  /** Health/wellness sector performance filter */
  sectorPerformance?: {
    sector: string;
    minGmv?: number;
  };
  /** Minimum engagement rate (0-1 decimal) */
  minEngagementRate?: number;
  /** Product category filter */
  productCategory?: string;
  /** Content type filter */
  contentType?: string;
  /** Minimum average video views */
  minAvgVideoViews?: number;
  /** Posting frequency filter */
  postingFrequency?: "daily" | "weekly" | "biweekly" | "monthly";
  /** Sample reliability rating */
  sampleReliability?: "high" | "medium" | "low";
  /** Pagination cursor */
  cursor?: string;
  /** Results per page */
  pageSize?: number;
}

export interface EngagementMetrics {
  likes: number;
  shares: number;
  comments: number;
  conversionRate: number;
  avgVideoViews: number;
  engagementRate: number;
}

export interface CreatorDemographics {
  topCountries: Array<{ country: string; percentage: number }>;
  ageDistribution: Array<{ range: string; percentage: number }>;
  genderDistribution: Array<{ gender: string; percentage: number }>;
}

export interface CreatorProfile {
  creatorId: string;
  handle: string;
  displayName: string;
  followerCount: number;
  violationCount: number;
  engagementMetrics: EngagementMetrics;
  nicheTags: string[];
  demographics: CreatorDemographics;
  gmv: number;
  postingFrequency: string;
  sampleReliability: string;
  bio: string;
}

export interface CreatorSearchResult {
  creators: CreatorProfile[];
  cursor?: string;
  totalCount: number;
}

// --- Commission ---

export interface CommissionTier {
  min: number;
  max: number;
  rate: number;
}

export interface CommissionConfig {
  type: "flat" | "tiered" | "auto_optimized";
  /** Flat rate percentage (1-80), used when type is 'flat' */
  flatRate?: number;
  /** Tiered commission brackets, used when type is 'tiered' */
  tiers?: CommissionTier[];
}

// --- Samples ---

export type SampleType =
  | "free_manual"
  | "free_auto_optimized"
  | "free_auto_approve"
  | "refundable";

export interface SampleShippingAddress {
  name: string;
  address: string;
  city: string;
  postcode: string;
  country: string;
  phone: string;
}

export interface SampleRequest {
  requestId: string;
  creatorId: string;
  creatorHandle: string;
  productId: string;
  sampleType: SampleType;
  requestedAt: Date;
  /** 72 hours from requestedAt — agent must respond before this */
  deadline: Date;
  /** ISO timestamp of the deadline */
  deadlineAt: string;
  /** Creator's shipping address for fulfillment */
  shippingAddress: SampleShippingAddress;
  /** Current status of the request */
  status?: "pending" | "approved" | "rejected" | "expired";
}

export interface SampleDecision {
  requestId: string;
  decision: "approve" | "reject";
  reason?: string;
}

/**
 * Open Collaboration sample request with additional fields
 * returned when listing pending sample requests for a product.
 */
export interface OpenSampleRequest {
  requestId: string;
  creatorId: string;
  creatorHandle: string;
  productId: string;
  sampleType: SampleType;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedAt: Date;
  deadlineAt: string;
}

/**
 * Response from enrolling a product in a collaboration plan.
 */
export interface CollaborationResponse {
  collaborationId: string;
  creatorId: string;
  status: "pending" | "active" | "accepted" | "rejected" | "expired";
}

/**
 * Daily invitation count status returned by getDailyInviteCount.
 */
export interface DailyInviteStatus {
  count: number;
  limit: number;
}

// --- Collaborations ---

export type CollaborationType = "open" | "target";

export interface OpenCollaborationConfig {
  /** Product IDs to enroll in Open Plan */
  productIds: string[];
  /** Commission configuration (flat, tiered, or auto-optimized) */
  commissionConfig: CommissionConfig;
  /** Auto-approve sample requests from creators above this engagement rate */
  autoApproveThreshold?: number;
  /** Supported sample types for this collaboration */
  sampleTypes: SampleType[];
}

export interface TargetCollaborationConfig {
  /** Specific creator IDs to invite */
  creatorIds: string[];
  /** Product IDs included in the collaboration */
  productIds: string[];
  /** Commission configuration — supersedes any Open collaboration rate */
  commissionConfig: CommissionConfig;
  /** Sample type for target collaboration (free_manual or free_auto_approve) */
  sampleType: SampleType;
  /** Optional personalised invitation message */
  message?: string;
}

export type TargetInvitationStatus =
  | "pending"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired";

export interface TargetInvitation {
  invitationId: string;
  creatorId: string;
  campaignId: string;
  status: TargetInvitationStatus;
  sentAt?: Date;
}

// --- IM Messaging ---

export type IMMessageType =
  | "content_brief"
  | "sample_update"
  | "tracking_info"
  | "general";

export interface IMMessage {
  recipientId: string;
  content: string;
  messageType: IMMessageType;
}

export interface IMSendResult {
  messageId: string;
  sent: boolean;
  fallbackUsed: boolean;
}

// --- API Error ---

export interface TikTokApiError {
  code: string;
  message: string;
  requestId?: string;
}
