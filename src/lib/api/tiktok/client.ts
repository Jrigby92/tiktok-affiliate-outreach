import type {
  CreatorSearchFilters,
  CreatorSearchResult,
  OpenCollaborationConfig,
  TargetCollaborationConfig,
  TargetInvitation,
  SampleDecision,
  SampleRequest,
  OpenSampleRequest,
  DailyInviteStatus,
  IMMessage,
  IMSendResult,
  TikTokApiError,
} from "./types";

// ============================================================
// TikTok Affiliate Seller API Client
// ============================================================

const DEFAULT_BASE_URL = "https://open-api.tiktok.com";
const MAX_DAILY_INVITATIONS = 1000;

export class TikTokApiClient {
  private accessToken: string;
  private baseUrl: string;

  /** Daily invitation counter — resets at midnight UTC */
  private dailyInvitationCount = 0;
  private dailyInvitationDate: string = new Date()
    .toISOString()
    .slice(0, 10);

  constructor(accessToken: string, baseUrl?: string) {
    this.accessToken = accessToken;
    this.baseUrl = baseUrl || DEFAULT_BASE_URL;
  }

  // ----------------------------------------------------------
  // Creator Discovery
  // ----------------------------------------------------------

  async searchCreators(
    filters: CreatorSearchFilters
  ): Promise<CreatorSearchResult> {
    const body: Record<string, unknown> = {};

    if (filters.minFollowers !== undefined)
      body.min_followers = filters.minFollowers;
    if (filters.maxViolations !== undefined)
      body.max_violations = filters.maxViolations;
    if (filters.demographics) {
      body.demographics = {
        country: filters.demographics.country,
        age_range: filters.demographics.ageRange
          ? {
              min: filters.demographics.ageRange.min,
              max: filters.demographics.ageRange.max,
            }
          : undefined,
        gender: filters.demographics.gender,
      };
    }
    if (filters.sectorPerformance) {
      body.sector_performance = {
        sector: filters.sectorPerformance.sector,
        min_gmv: filters.sectorPerformance.minGmv,
      };
    }
    if (filters.minEngagementRate !== undefined)
      body.min_engagement_rate = filters.minEngagementRate;
    if (filters.productCategory)
      body.product_category = filters.productCategory;
    if (filters.contentType) body.content_type = filters.contentType;
    if (filters.minAvgVideoViews !== undefined)
      body.min_avg_video_views = filters.minAvgVideoViews;
    if (filters.postingFrequency)
      body.posting_frequency = filters.postingFrequency;
    if (filters.sampleReliability)
      body.sample_reliability = filters.sampleReliability;
    if (filters.cursor) body.cursor = filters.cursor;
    if (filters.pageSize) body.page_size = filters.pageSize;

    const data = await this.request<{
      data: {
        creators: Array<Record<string, unknown>>;
        cursor?: string;
        total_count: number;
      };
    }>("POST", "/affiliate/creator/search", body);

    return {
      creators: (data.data.creators || []).map((c) => ({
        creatorId: String(c.creator_id ?? ""),
        handle: String(c.handle ?? ""),
        displayName: String(c.display_name ?? ""),
        followerCount: Number(c.follower_count ?? 0),
        violationCount: Number(c.violation_count ?? 0),
        engagementMetrics: {
          likes: Number(
            (c.engagement_metrics as Record<string, unknown>)?.likes ?? 0
          ),
          shares: Number(
            (c.engagement_metrics as Record<string, unknown>)?.shares ?? 0
          ),
          comments: Number(
            (c.engagement_metrics as Record<string, unknown>)?.comments ?? 0
          ),
          conversionRate: Number(
            (c.engagement_metrics as Record<string, unknown>)
              ?.conversion_rate ?? 0
          ),
          avgVideoViews: Number(
            (c.engagement_metrics as Record<string, unknown>)
              ?.avg_video_views ?? 0
          ),
          engagementRate: Number(
            (c.engagement_metrics as Record<string, unknown>)
              ?.engagement_rate ?? 0
          ),
        },
        nicheTags: Array.isArray(c.niche_tags)
          ? (c.niche_tags as string[])
          : [],
        demographics: {
          topCountries: Array.isArray(
            (c.demographics as Record<string, unknown>)?.top_countries
          )
            ? ((
                (c.demographics as Record<string, unknown>)
                  ?.top_countries as Array<Record<string, unknown>>
              ).map((tc) => ({
                country: String(tc.country ?? ""),
                percentage: Number(tc.percentage ?? 0),
              })))
            : [],
          ageDistribution: Array.isArray(
            (c.demographics as Record<string, unknown>)?.age_distribution
          )
            ? ((
                (c.demographics as Record<string, unknown>)
                  ?.age_distribution as Array<Record<string, unknown>>
              ).map((ad) => ({
                range: String(ad.range ?? ""),
                percentage: Number(ad.percentage ?? 0),
              })))
            : [],
          genderDistribution: Array.isArray(
            (c.demographics as Record<string, unknown>)
              ?.gender_distribution
          )
            ? ((
                (c.demographics as Record<string, unknown>)
                  ?.gender_distribution as Array<Record<string, unknown>>
              ).map((gd) => ({
                gender: String(gd.gender ?? ""),
                percentage: Number(gd.percentage ?? 0),
              })))
            : [],
        },
        gmv: Number(c.gmv ?? 0),
        postingFrequency: String(c.posting_frequency ?? ""),
        sampleReliability: String(c.sample_reliability ?? ""),
        bio: String(c.bio ?? ""),
      })),
      cursor: data.data.cursor,
      totalCount: data.data.total_count,
    };
  }

  // ----------------------------------------------------------
  // Open Collaboration
  // ----------------------------------------------------------

  async enrollOpenCollaboration(
    config: OpenCollaborationConfig
  ): Promise<{ collaborationId: string }> {
    const body: Record<string, unknown> = {
      product_ids: config.productIds,
      commission_config: {
        type: config.commissionConfig.type,
        flat_rate: config.commissionConfig.flatRate,
        tiers: config.commissionConfig.tiers?.map((t) => ({
          min: t.min,
          max: t.max,
          rate: t.rate,
        })),
      },
      sample_types: config.sampleTypes,
    };

    if (config.autoApproveThreshold !== undefined) {
      body.auto_approve_threshold = config.autoApproveThreshold;
    }

    const data = await this.request<{
      data: { collaboration_id: string };
    }>("POST", "/affiliate/open_collaboration/enroll", body);

    return { collaborationId: data.data.collaboration_id };
  }

  // ----------------------------------------------------------
  // Target Collaboration
  // ----------------------------------------------------------

  async createTargetCampaign(
    config: TargetCollaborationConfig
  ): Promise<{ campaignId: string; invitations: TargetInvitation[] }> {
    // Enforce 1,000 invitations per 24-hour limit
    this.resetDailyCounterIfNeeded();

    const remainingQuota =
      MAX_DAILY_INVITATIONS - this.dailyInvitationCount;
    if (config.creatorIds.length > remainingQuota) {
      throw new Error(
        `Daily invitation limit would be exceeded. ` +
          `Requested: ${config.creatorIds.length}, ` +
          `Remaining today: ${remainingQuota}/${MAX_DAILY_INVITATIONS}`
      );
    }

    const body: Record<string, unknown> = {
      creator_ids: config.creatorIds,
      product_ids: config.productIds,
      commission_config: {
        type: config.commissionConfig.type,
        flat_rate: config.commissionConfig.flatRate,
        tiers: config.commissionConfig.tiers?.map((t) => ({
          min: t.min,
          max: t.max,
          rate: t.rate,
        })),
      },
      sample_type: config.sampleType,
    };

    if (config.message) {
      body.message = config.message;
    }

    const data = await this.request<{
      data: {
        campaign_id: string;
        invitations: Array<{
          invitation_id: string;
          creator_id: string;
          status: string;
          sent_at?: string;
        }>;
      };
    }>("POST", "/affiliate/target_collaboration/create", body);

    // Update daily counter
    this.dailyInvitationCount += config.creatorIds.length;

    return {
      campaignId: data.data.campaign_id,
      invitations: (data.data.invitations || []).map((inv) => ({
        invitationId: inv.invitation_id,
        creatorId: inv.creator_id,
        campaignId: data.data.campaign_id,
        status: inv.status as TargetInvitation["status"],
        sentAt: inv.sent_at ? new Date(inv.sent_at) : undefined,
      })),
    };
  }

  // ----------------------------------------------------------
  // Sample Management
  // ----------------------------------------------------------

  async manageSample(decision: SampleDecision): Promise<void> {
    const body: Record<string, unknown> = {
      request_id: decision.requestId,
      decision: decision.decision,
    };

    if (decision.reason) {
      body.reason = decision.reason;
    }

    await this.request("POST", "/affiliate/samples/manage", body);
  }

  // ----------------------------------------------------------
  // IM Messaging (with collaboration invitation fallback)
  // ----------------------------------------------------------

  async sendIM(
    message: IMMessage
  ): Promise<IMSendResult> {
    // Attempt IM first
    try {
      const data = await this.request<{
        data: { message_id: string };
      }>("POST", "/affiliate/im/send", {
        recipient_id: message.recipientId,
        content: message.content,
        message_type: message.messageType,
      });

      return {
        messageId: data.data.message_id,
        sent: true,
        fallbackUsed: false,
      };
    } catch (error: unknown) {
      // If IM endpoint is unavailable or rate-limited, fall back to
      // collaboration invitation messaging
      const isImUnavailable =
        error instanceof TikTokApiRequestError &&
        (error.statusCode === 404 ||
          error.statusCode === 429 ||
          error.code === "im_not_available");

      if (!isImUnavailable) {
        throw error;
      }

      // Fallback: send via collaboration invitation message
      const fallbackData = await this.request<{
        data: { message_id: string };
      }>("POST", "/affiliate/collaboration/message", {
        recipient_id: message.recipientId,
        content: message.content,
        message_type: message.messageType,
      });

      return {
        messageId: fallbackData.data.message_id,
        sent: true,
        fallbackUsed: true,
      };
    }
  }

  // ----------------------------------------------------------
  // Sample Request Management
  // ----------------------------------------------------------

  /**
   * Get a single sample request by its ID.
   */
  async getSampleRequest(requestId: string): Promise<SampleRequest> {
    const data = await this.request<{
      data: {
        request_id: string;
        creator_id: string;
        creator_handle: string;
        product_id: string;
        sample_type: string;
        requested_at: string;
        deadline_at: string;
        status: string;
        shipping_address: {
          name: string;
          address: string;
          city: string;
          postcode: string;
          country: string;
          phone: string;
        };
      };
    }>("GET", `/affiliate/samples/requests/${requestId}`);

    const d = data.data;
    return {
      requestId: d.request_id,
      creatorId: d.creator_id,
      creatorHandle: d.creator_handle,
      productId: d.product_id,
      sampleType: d.sample_type as SampleRequest["sampleType"],
      requestedAt: new Date(d.requested_at),
      deadline: new Date(d.deadline_at),
      deadlineAt: d.deadline_at,
      status: d.status as SampleRequest["status"],
      shippingAddress: {
        name: d.shipping_address.name,
        address: d.shipping_address.address,
        city: d.shipping_address.city,
        postcode: d.shipping_address.postcode,
        country: d.shipping_address.country,
        phone: d.shipping_address.phone,
      },
    };
  }

  /**
   * Submit an approve/reject decision for a sample request.
   */
  async decideSample(decision: SampleDecision): Promise<void> {
    const body: Record<string, unknown> = {
      request_id: decision.requestId,
      decision: decision.decision,
    };

    if (decision.reason) {
      body.reason = decision.reason;
    }

    await this.request("POST", "/affiliate/samples/decide", body);
  }

  /**
   * List all sample requests, optionally filtered by status.
   */
  async listAllSampleRequests(
    status?: string
  ): Promise<SampleRequest[]> {
    const params = status ? `?status=${encodeURIComponent(status)}` : "";
    const data = await this.request<{
      data: {
        requests: Array<{
          request_id: string;
          creator_id: string;
          creator_handle: string;
          product_id: string;
          sample_type: string;
          requested_at: string;
          deadline_at: string;
          status: string;
          shipping_address: {
            name: string;
            address: string;
            city: string;
            postcode: string;
            country: string;
            phone: string;
          };
        }>;
      };
    }>("GET", `/affiliate/samples/requests${params}`);

    return (data.data.requests || []).map((r) => ({
      requestId: r.request_id,
      creatorId: r.creator_id,
      creatorHandle: r.creator_handle,
      productId: r.product_id,
      sampleType: r.sample_type as SampleRequest["sampleType"],
      requestedAt: new Date(r.requested_at),
      deadline: new Date(r.deadline_at),
      deadlineAt: r.deadline_at,
      status: r.status as SampleRequest["status"],
      shippingAddress: {
        name: r.shipping_address.name,
        address: r.shipping_address.address,
        city: r.shipping_address.city,
        postcode: r.shipping_address.postcode,
        country: r.shipping_address.country,
        phone: r.shipping_address.phone,
      },
    }));
  }

  /**
   * List pending sample requests for a specific product (Open Collaboration).
   */
  async listOpenSampleRequests(
    productId?: string
  ): Promise<OpenSampleRequest[]> {
    const params = productId
      ? `?product_id=${encodeURIComponent(productId)}`
      : "";
    const data = await this.request<{
      data: {
        requests: Array<{
          request_id: string;
          creator_id: string;
          creator_handle: string;
          product_id: string;
          sample_type: string;
          status: string;
          requested_at: string;
          deadline_at: string;
        }>;
      };
    }>("GET", `/affiliate/open_collaboration/sample_requests${params}`);

    return (data.data.requests || []).map((r) => ({
      requestId: r.request_id,
      creatorId: r.creator_id,
      creatorHandle: r.creator_handle,
      productId: r.product_id,
      sampleType: r.sample_type as OpenSampleRequest["sampleType"],
      status: r.status as OpenSampleRequest["status"],
      requestedAt: new Date(r.requested_at),
      deadlineAt: r.deadline_at,
    }));
  }

  // ----------------------------------------------------------
  // Daily Invitation Counter
  // ----------------------------------------------------------

  /**
   * Get daily invitation count as a status object.
   * Used by TargetCollaborationManager to check limits.
   */
  getDailyInviteCount(): DailyInviteStatus {
    this.resetDailyCounterIfNeeded();
    return {
      count: this.dailyInvitationCount,
      limit: MAX_DAILY_INVITATIONS,
    };
  }

  getDailyInvitationCount(): number {
    this.resetDailyCounterIfNeeded();
    return this.dailyInvitationCount;
  }

  getRemainingDailyInvitations(): number {
    this.resetDailyCounterIfNeeded();
    return MAX_DAILY_INVITATIONS - this.dailyInvitationCount;
  }

  private resetDailyCounterIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyInvitationDate) {
      this.dailyInvitationCount = 0;
      this.dailyInvitationDate = today;
    }
  }

  // ----------------------------------------------------------
  // HTTP Transport
  // ----------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      let errorBody: TikTokApiError | undefined;
      try {
        errorBody = (await response.json()) as TikTokApiError;
      } catch {
        // Response body was not JSON
      }

      throw new TikTokApiRequestError(
        errorBody?.message || `TikTok API error: ${response.status}`,
        response.status,
        errorBody?.code,
        errorBody?.requestId
      );
    }

    return (await response.json()) as T;
  }
}

// ============================================================
// Custom Error Class
// ============================================================

export class TikTokApiRequestError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    code?: string,
    requestId?: string
  ) {
    super(message);
    this.name = "TikTokApiRequestError";
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
  }
}
