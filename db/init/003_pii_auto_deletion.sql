-- 003_pii_auto_deletion.sql
-- UK GDPR Article 17 — PII auto-deletion after 30 days post-delivery
-- Legal basis: Right to Erasure + storage limitation principle

-- ============================================================
-- Function: scrub_expired_pii()
-- Finds orders with status='DELIVERED' and delivered_at + 30 days < NOW(),
-- then strips all PII from pii_data, keeping only 'region' and 'product' keys.
-- Called by trigger on INSERT/UPDATE of status column.
-- ============================================================
CREATE OR REPLACE FUNCTION scrub_expired_pii()
RETURNS TRIGGER AS $$
BEGIN
    -- Only act when status is set to DELIVERED
    IF NEW.status = 'DELIVERED' THEN
        -- Set delivered_at if not already set
        IF NEW.delivered_at IS NULL THEN
            NEW.delivered_at = NOW();
        END IF;

        -- Check if 30 days have elapsed since delivery
        IF NEW.delivered_at + INTERVAL '30 days' < NOW() THEN
            -- Scrub PII: keep only 'region' and 'product' keys
            NEW.pii_data = jsonb_build_object(
                'region', COALESCE(NEW.pii_data->'region', '"unknown"'::jsonb),
                'product', COALESCE(NEW.pii_data->'product', '"unknown"'::jsonb),
                'pii_scrubbed', to_jsonb(true),
                'scrubbed_at', to_jsonb(NOW()::text)
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Trigger: fires on INSERT or UPDATE of status on orders table
-- ============================================================
DROP TRIGGER IF EXISTS trg_pii_auto_deletion ON orders;
CREATE TRIGGER trg_pii_auto_deletion
    BEFORE INSERT OR UPDATE OF status ON orders
    FOR EACH ROW
    EXECUTE FUNCTION scrub_expired_pii();

-- ============================================================
-- Standalone function: run_pii_scrub()
-- Can be called by pg_cron or manually to batch-scrub all
-- expired PII across the orders table.
-- Returns the number of rows scrubbed.
-- ============================================================
CREATE OR REPLACE FUNCTION run_pii_scrub()
RETURNS INTEGER AS $$
DECLARE
    scrubbed_count INTEGER;
BEGIN
    UPDATE orders
    SET pii_data = jsonb_build_object(
            'region', COALESCE(pii_data->'region', '"unknown"'::jsonb),
            'product', COALESCE(pii_data->'product', '"unknown"'::jsonb),
            'pii_scrubbed', to_jsonb(true),
            'scrubbed_at', to_jsonb(NOW()::text)
        ),
        updated_at = NOW()
    WHERE status = 'DELIVERED'
      AND delivered_at IS NOT NULL
      AND delivered_at + INTERVAL '30 days' < NOW()
      AND (pii_data->>'pii_scrubbed' IS NULL OR pii_data->>'pii_scrubbed' != 'true');

    GET DIAGNOSTICS scrubbed_count = ROW_COUNT;
    RETURN scrubbed_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Optional: pg_cron schedule (uncomment if pg_cron is installed)
-- Runs daily at 3:00 AM to scrub expired PII
-- ============================================================
-- SELECT cron.schedule('pii-scrub-daily', '0 3 * * *', 'SELECT run_pii_scrub()');
