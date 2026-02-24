import { Pool } from "pg";

/**
 * Scrub PII from orders that have been delivered for more than 30 days.
 * Preserves anonymized geographic region and product data for analytics.
 * Legal basis: UK GDPR Article 17 (Right to Erasure) + storage limitation principle.
 */
export async function scrubExpiredPii(db: Pool): Promise<number> {
  const result = await db.query(`
    UPDATE orders
    SET pii_data = jsonb_build_object(
      'region', pii_data->'region',
      'product', pii_data->'product'
    ),
    updated_at = NOW()
    WHERE status = 'DELIVERED'
      AND delivered_at IS NOT NULL
      AND delivered_at + INTERVAL '30 days' < NOW()
      AND pii_data ? 'name'
    RETURNING id
  `);
  return result.rowCount || 0;
}

/**
 * Erase all PII for a specific data subject across all tables.
 * Supports manual Right to Erasure requests (UK GDPR Article 17).
 */
export async function eraseAllPiiForSubject(
  db: Pool,
  subjectId: string
): Promise<{ tablesAffected: string[]; rowsDeleted: number }> {
  const tablesAffected: string[] = [];
  let totalRows = 0;

  // Orders table — scrub PII data but keep the order record
  const ordersResult = await db.query(
    `UPDATE orders SET pii_data = '{}', updated_at = NOW() WHERE pii_data->>'subject_id' = $1 RETURNING id`,
    [subjectId]
  );
  if (ordersResult.rowCount && ordersResult.rowCount > 0) {
    tablesAffected.push("orders");
    totalRows += ordersResult.rowCount;
  }

  // Creators table — remove the creator record entirely
  const creatorsResult = await db.query(
    `DELETE FROM creators WHERE handle = $1 RETURNING id`,
    [subjectId]
  );
  if (creatorsResult.rowCount && creatorsResult.rowCount > 0) {
    tablesAffected.push("creators");
    totalRows += creatorsResult.rowCount;
  }

  return { tablesAffected, rowsDeleted: totalRows };
}
