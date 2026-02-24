-- 002_tables.sql
-- Core tables: creators, regulations, orders, profitability

-- ============================================================
-- 1. creators — Creator Intelligence
-- ============================================================
CREATE TABLE IF NOT EXISTS creators (
    id              SERIAL PRIMARY KEY,
    handle          TEXT UNIQUE NOT NULL,
    follower_count  INT,
    engagement_metrics JSONB DEFAULT '{}',
    niche_tags      TEXT[] DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. regulations — Regulatory RAG Store
-- ============================================================
CREATE TABLE IF NOT EXISTS regulations (
    id                SERIAL PRIMARY KEY,
    regulation_text   TEXT NOT NULL,
    embedding_vector  VECTOR(1536),
    source_authority  TEXT CHECK (source_authority IN ('MHRA', 'ASA', 'CAP')),
    rule_number       TEXT,
    last_updated      TIMESTAMPTZ DEFAULT NOW(),
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. orders — Transactions & Fulfillment
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
    id                  SERIAL PRIMARY KEY,
    fulfillment_id      TEXT,
    tracking_num        TEXT,
    pii_data            JSONB DEFAULT '{}',
    status              TEXT DEFAULT 'PENDING',
    status_webhook_log  JSONB DEFAULT '[]',
    delivered_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. profitability — Financial Controls
-- ============================================================
CREATE TABLE IF NOT EXISTS profitability (
    id              SERIAL PRIMARY KEY,
    product_sku     TEXT UNIQUE NOT NULL,
    commission_tier NUMERIC,
    cogs            NUMERIC,
    net_margin      NUMERIC,
    velocity_limit  NUMERIC,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================

-- creators
CREATE INDEX IF NOT EXISTS idx_creators_handle ON creators (handle);
CREATE INDEX IF NOT EXISTS idx_creators_niche_tags ON creators USING GIN (niche_tags);

-- regulations
CREATE INDEX IF NOT EXISTS idx_regulations_source_authority ON regulations (source_authority);

-- orders
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_id ON orders (fulfillment_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

-- profitability
CREATE INDEX IF NOT EXISTS idx_profitability_product_sku ON profitability (product_sku);

-- pgvector ivfflat index for cosine similarity search on regulation embeddings
-- Note: ivfflat requires at least some rows to exist for training.
-- Using lists=100 as a reasonable default; adjust based on dataset size.
-- This index is created with IF NOT EXISTS to be idempotent.
CREATE INDEX IF NOT EXISTS idx_regulations_embedding_vector
    ON regulations
    USING ivfflat (embedding_vector vector_cosine_ops)
    WITH (lists = 100);

-- ============================================================
-- Auto-update updated_at timestamps
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_creators_updated_at
    BEFORE UPDATE ON creators
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_profitability_updated_at
    BEFORE UPDATE ON profitability
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
