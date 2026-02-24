/**
 * Dashboard data queries — server-side only.
 * Used by Next.js Server Components to fetch display data.
 */

import { Pool } from "pg";

// ─── Collaborations Overview ───

export interface CollaborationRow {
  id: number;
  collaborationId: string;
  type: "open" | "target";
  creatorId: string;
  productIds: string[];
  commissionConfig: Record<string, unknown>;
  sampleType: string;
  status: string;
  matchScore: number | null;
  createdAt: Date;
}

export async function getActiveCollaborations(
  db: Pool
): Promise<CollaborationRow[]> {
  const result = await db.query(
    `SELECT id, collaboration_id, type, creator_id, product_ids,
            commission_config, sample_type, status, match_score, created_at
     FROM collaborations
     WHERE status IN ('pending', 'accepted', 'active')
     ORDER BY created_at DESC
     LIMIT 100`
  );
  return result.rows.map(rowToCollaboration);
}

export async function getCollaborationStats(
  db: Pool
): Promise<{ open: number; target: number; pending: number; active: number }> {
  const result = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE type = 'open') AS open,
      COUNT(*) FILTER (WHERE type = 'target') AS target,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'active') AS active
    FROM collaborations
  `);
  const row = result.rows[0];
  return {
    open: parseInt(row.open, 10) || 0,
    target: parseInt(row.target, 10) || 0,
    pending: parseInt(row.pending, 10) || 0,
    active: parseInt(row.active, 10) || 0,
  };
}

function rowToCollaboration(row: Record<string, unknown>): CollaborationRow {
  return {
    id: row.id as number,
    collaborationId: row.collaboration_id as string,
    type: row.type as "open" | "target",
    creatorId: row.creator_id as string,
    productIds: (row.product_ids as string[]) || [],
    commissionConfig:
      (row.commission_config as Record<string, unknown>) || {},
    sampleType: (row.sample_type as string) || "",
    status: row.status as string,
    matchScore: row.match_score as number | null,
    createdAt: new Date(row.created_at as string),
  };
}

// ─── Pending Approvals ───

export interface ContentBriefRow {
  id: number;
  briefId: string;
  trendData: Record<string, unknown>;
  productData: Record<string, unknown>;
  regulatoryCheck: Record<string, unknown>;
  creativeGuards: Record<string, unknown>;
  briefText: string;
  approvalStatus: string;
  targetCreatorIds: string[];
  ownerNotes: string | null;
  createdAt: Date;
}

export async function getPendingBriefs(
  db: Pool
): Promise<ContentBriefRow[]> {
  const result = await db.query(
    `SELECT * FROM content_briefs
     WHERE approval_status = 'pending_approval'
     ORDER BY created_at DESC
     LIMIT 50`
  );
  return result.rows.map(rowToContentBrief);
}

export async function getAllBriefs(
  db: Pool,
  limit = 50
): Promise<ContentBriefRow[]> {
  const result = await db.query(
    `SELECT * FROM content_briefs ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows.map(rowToContentBrief);
}

export async function getBriefById(
  db: Pool,
  briefId: string
): Promise<ContentBriefRow | null> {
  const result = await db.query(
    "SELECT * FROM content_briefs WHERE brief_id = $1",
    [briefId]
  );
  if (result.rows.length === 0) return null;
  return rowToContentBrief(result.rows[0]);
}

export async function updateBriefStatus(
  db: Pool,
  briefId: string,
  status: string,
  notes?: string
): Promise<void> {
  await db.query(
    `UPDATE content_briefs
     SET approval_status = $1, owner_notes = $2, updated_at = NOW()
     WHERE brief_id = $3`,
    [status, notes || null, briefId]
  );
}

function rowToContentBrief(row: Record<string, unknown>): ContentBriefRow {
  return {
    id: row.id as number,
    briefId: row.brief_id as string,
    trendData: (row.trend_data as Record<string, unknown>) || {},
    productData: (row.product_data as Record<string, unknown>) || {},
    regulatoryCheck: (row.regulatory_check as Record<string, unknown>) || {},
    creativeGuards: (row.creative_guards as Record<string, unknown>) || {},
    briefText: (row.brief_text as string) || "",
    approvalStatus: row.approval_status as string,
    targetCreatorIds: (row.target_creator_ids as string[]) || [],
    ownerNotes: (row.owner_notes as string) || null,
    createdAt: new Date(row.created_at as string),
  };
}

// ─── HITL Review Queue ───

export interface ReviewQueueRow {
  id: number;
  reviewId: string;
  contentText: string;
  retrievedChunks: Record<string, unknown>[];
  judgeVerdict: Record<string, unknown>;
  confidenceScore: number;
  triggeredRules: string[];
  decision: string;
  reviewerNotes: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export async function getPendingReviews(
  db: Pool
): Promise<ReviewQueueRow[]> {
  const result = await db.query(
    `SELECT * FROM review_queue
     WHERE decision = 'pending'
     ORDER BY created_at DESC
     LIMIT 50`
  );
  return result.rows.map(rowToReview);
}

export async function getAllReviews(
  db: Pool,
  limit = 50
): Promise<ReviewQueueRow[]> {
  const result = await db.query(
    `SELECT * FROM review_queue ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows.map(rowToReview);
}

export async function getReviewById(
  db: Pool,
  reviewId: string
): Promise<ReviewQueueRow | null> {
  const result = await db.query(
    "SELECT * FROM review_queue WHERE review_id = $1",
    [reviewId]
  );
  if (result.rows.length === 0) return null;
  return rowToReview(result.rows[0]);
}

export async function updateReviewDecision(
  db: Pool,
  reviewId: string,
  decision: string,
  notes?: string
): Promise<void> {
  await db.query(
    `UPDATE review_queue
     SET decision = $1, reviewer_notes = $2, decided_at = NOW()
     WHERE review_id = $3`,
    [decision, notes || null, reviewId]
  );
}

export async function insertReview(
  db: Pool,
  data: {
    reviewId: string;
    contentText: string;
    retrievedChunks: unknown[];
    judgeVerdict: Record<string, unknown>;
    confidenceScore: number;
    triggeredRules: string[];
  }
): Promise<void> {
  await db.query(
    `INSERT INTO review_queue
       (review_id, content_text, retrieved_chunks, judge_verdict, confidence_score, triggered_rules)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      data.reviewId,
      data.contentText,
      JSON.stringify(data.retrievedChunks),
      JSON.stringify(data.judgeVerdict),
      data.confidenceScore,
      data.triggeredRules,
    ]
  );
}

function rowToReview(row: Record<string, unknown>): ReviewQueueRow {
  return {
    id: row.id as number,
    reviewId: row.review_id as string,
    contentText: row.content_text as string,
    retrievedChunks: (row.retrieved_chunks as Record<string, unknown>[]) || [],
    judgeVerdict: (row.judge_verdict as Record<string, unknown>) || {},
    confidenceScore: parseFloat(String(row.confidence_score)),
    triggeredRules: (row.triggered_rules as string[]) || [],
    decision: row.decision as string,
    reviewerNotes: (row.reviewer_notes as string) || null,
    createdAt: new Date(row.created_at as string),
    decidedAt: row.decided_at ? new Date(row.decided_at as string) : null,
  };
}

// ─── Agent Activity Feed ───

export interface ActivityRow {
  id: number;
  actionType: string;
  details: Record<string, unknown>;
  status: string;
  createdAt: Date;
}

export async function getRecentActivity(
  db: Pool,
  limit = 50
): Promise<ActivityRow[]> {
  const result = await db.query(
    `SELECT * FROM agent_activity_log
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => ({
    id: row.id as number,
    actionType: row.action_type as string,
    details: (row.details as Record<string, unknown>) || {},
    status: row.status as string,
    createdAt: new Date(row.created_at as string),
  }));
}

export async function logActivity(
  db: Pool,
  actionType: string,
  details: Record<string, unknown>,
  status = "completed"
): Promise<void> {
  await db.query(
    `INSERT INTO agent_activity_log (action_type, details, status) VALUES ($1, $2, $3)`,
    [actionType, JSON.stringify(details), status]
  );
}

// ─── Cost Dashboard ───

export interface CostSummary {
  totalSpendGBP: number;
  spendByModel: Record<string, number>;
  spendByDay: { date: string; amount: number }[];
  totalCalls: number;
}

export async function getCostSummary(_db: Pool): Promise<CostSummary> {
  // Cost data comes from LangSmith API — we provide a structured interface.
  // In production this would query the LangSmith API.
  // For now return a placeholder that the dashboard can render.
  return {
    totalSpendGBP: 0,
    spendByModel: {},
    spendByDay: [],
    totalCalls: 0,
  };
}

// ─── Order Stats ───

export async function getOrderStats(
  db: Pool
): Promise<{
  total: number;
  pending: number;
  delivered: number;
  cancelled: number;
}> {
  const result = await db.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
      COUNT(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
      COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
    FROM orders
  `);
  const row = result.rows[0];
  return {
    total: parseInt(row.total, 10) || 0,
    pending: parseInt(row.pending, 10) || 0,
    delivered: parseInt(row.delivered, 10) || 0,
    cancelled: parseInt(row.cancelled, 10) || 0,
  };
}
