-- 004_oauth_tokens.sql
-- Encrypted OAuth token storage for TikTok and Amazon SP-API

CREATE TABLE IF NOT EXISTS oauth_tokens (
    id                        SERIAL PRIMARY KEY,
    provider                  TEXT NOT NULL CHECK (provider IN ('tiktok', 'amazon')),
    access_token_encrypted    TEXT NOT NULL,
    refresh_token_encrypted   TEXT,
    token_iv                  TEXT NOT NULL,
    refresh_iv                TEXT,
    expires_at                TIMESTAMPTZ,
    scopes                    TEXT[],
    created_at                TIMESTAMPTZ DEFAULT NOW(),
    updated_at                TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_oauth_tokens_provider UNIQUE (provider)
);

-- Auto-update updated_at on changes
CREATE TRIGGER trg_oauth_tokens_updated_at
    BEFORE UPDATE ON oauth_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
