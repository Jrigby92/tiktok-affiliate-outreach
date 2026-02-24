-- 005_collaboration_tables.sql
-- Collaboration, sample, invitation, matching, content brief, activity log, and review queue tables

-- ============================================================
-- 1. collaborations — Open and Target collaboration records
-- ============================================================
CREATE TABLE IF NOT EXISTS collaborations (
    id                SERIAL PRIMARY KEY,
    collaboration_id  TEXT UNIQUE NOT NULL,
    type              TEXT CHECK (type IN ('open', 'target')),
    creator_id        TEXT NOT NULL,
    product_ids       TEXT[] DEFAULT '{}',
    commission_config JSONB DEFAULT '{}',
    sample_type       TEXT,
    status            TEXT DEFAULT 'pending',
    match_score       NUMERIC,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. sample_decisions — Sample request tracking with 72-hour deadline
-- ============================================================
CREATE TABLE IF NOT EXISTS sample_decisions (
    id                  SERIAL PRIMARY KEY,
    sample_request_id   TEXT UNIQUE NOT NULL,
    collaboration_id    TEXT REFERENCES collaborations(collaboration_id),
    creator_id          TEXT NOT NULL,
    decision            TEXT CHECK (decision IN ('pending', 'approved', 'rejected')),
    decided_at          TIMESTAMPTZ,
    deadline_at         TIMESTAMPTZ NOT NULL,
    reason              TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. queued_invitations — Target Collaboration invitation queue
--    (max 1,000 invitations per 24 hours)
-- ============================================================
CREATE TABLE IF NOT EXISTS queued_invitations (
    id              SERIAL PRIMARY KEY,
    creator_id      TEXT NOT NULL,
    campaign_id     TEXT NOT NULL,
    scheduled_for   TIMESTAMPTZ NOT NULL,
    sent_at         TIMESTAMPTZ,
    status          TEXT DEFAULT 'queued',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. creator_product_matches — Match-making scores
-- ============================================================
CREATE TABLE IF NOT EXISTS creator_product_matches (
    id              SERIAL PRIMARY KEY,
    creator_id      TEXT NOT NULL,
    product_id      TEXT NOT NULL,
    match_score     NUMERIC NOT NULL,
    score_breakdown JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_creator_product_match UNIQUE (creator_id, product_id)
);

-- ============================================================
-- 5. content_briefs — 4-step content brief pipeline output
-- ============================================================
CREATE TABLE IF NOT EXISTS content_briefs (
    id                  SERIAL PRIMARY KEY,
    brief_id            TEXT UNIQUE NOT NULL,
    trend_data          JSONB DEFAULT '{}',
    product_data        JSONB DEFAULT '{}',
    regulatory_check    JSONB DEFAULT '{}',
    creative_guards     JSONB DEFAULT '{}',
    brief_text          TEXT,
    approval_status     TEXT DEFAULT 'pending_approval'
                        CHECK (approval_status IN ('pending_approval', 'approved', 'rejected', 'edited')),
    target_creator_ids  TEXT[] DEFAULT '{}',
    owner_notes         TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 6. agent_activity_log — Real-time agent action log
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_activity_log (
    id          SERIAL PRIMARY KEY,
    action_type TEXT NOT NULL,
    details     JSONB DEFAULT '{}',
    status      TEXT DEFAULT 'completed',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. review_queue — HITL review for <95% confidence outputs
-- ============================================================
CREATE TABLE IF NOT EXISTS review_queue (
    id                SERIAL PRIMARY KEY,
    review_id         TEXT UNIQUE NOT NULL,
    content_text      TEXT NOT NULL,
    retrieved_chunks  JSONB DEFAULT '[]',
    judge_verdict     JSONB DEFAULT '{}',
    confidence_score  NUMERIC NOT NULL,
    triggered_rules   TEXT[] DEFAULT '{}',
    decision          TEXT DEFAULT 'pending'
                      CHECK (decision IN ('pending', 'approved', 'rejected', 'edited')),
    reviewer_notes    TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    decided_at        TIMESTAMPTZ
);

-- ============================================================
-- Indexes
-- ============================================================

-- collaborations
CREATE INDEX IF NOT EXISTS idx_collaborations_creator_id ON collaborations (creator_id);
CREATE INDEX IF NOT EXISTS idx_collaborations_type ON collaborations (type);
CREATE INDEX IF NOT EXISTS idx_collaborations_status ON collaborations (status);

-- sample_decisions
CREATE INDEX IF NOT EXISTS idx_sample_decisions_creator_id ON sample_decisions (creator_id);
CREATE INDEX IF NOT EXISTS idx_sample_decisions_decision ON sample_decisions (decision);
CREATE INDEX IF NOT EXISTS idx_sample_decisions_deadline ON sample_decisions (deadline_at);

-- queued_invitations
CREATE INDEX IF NOT EXISTS idx_queued_invitations_status ON queued_invitations (status);
CREATE INDEX IF NOT EXISTS idx_queued_invitations_scheduled ON queued_invitations (scheduled_for);

-- creator_product_matches
CREATE INDEX IF NOT EXISTS idx_creator_product_matches_creator ON creator_product_matches (creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_product_matches_score ON creator_product_matches (match_score DESC);

-- content_briefs
CREATE INDEX IF NOT EXISTS idx_content_briefs_approval_status ON content_briefs (approval_status);

-- agent_activity_log
CREATE INDEX IF NOT EXISTS idx_agent_activity_log_action_type ON agent_activity_log (action_type);
CREATE INDEX IF NOT EXISTS idx_agent_activity_log_created_at ON agent_activity_log (created_at DESC);

-- review_queue
CREATE INDEX IF NOT EXISTS idx_review_queue_decision ON review_queue (decision);
CREATE INDEX IF NOT EXISTS idx_review_queue_confidence ON review_queue (confidence_score);

-- ============================================================
-- Auto-update updated_at triggers
-- ============================================================
CREATE TRIGGER trg_collaborations_updated_at
    BEFORE UPDATE ON collaborations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_content_briefs_updated_at
    BEFORE UPDATE ON content_briefs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
