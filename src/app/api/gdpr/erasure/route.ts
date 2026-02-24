/**
 * Manual Right to Erasure API — UK GDPR Article 17
 *
 * DELETE /api/gdpr/erasure?subject_id=<id>
 *
 * In addition to the automatic PII deletion (30 days post-delivery),
 * this endpoint handles manual erasure requests.
 *
 * - Deletes ALL PII for the individual across all tables
 * - Returns: what was deleted, which tables, timestamp
 * - Handles active/pending orders: defer until fulfillment + 30 days
 * - Logs erasure event for audit
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { logActivity } from "@/lib/dashboard/queries";

export async function DELETE(request: NextRequest) {
  const subjectId = request.nextUrl.searchParams.get("subject_id");

  if (!subjectId) {
    return NextResponse.json(
      { error: "subject_id query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const db = getPool();
    const timestamp = new Date().toISOString();
    const tablesAffected: string[] = [];
    let totalRowsAffected = 0;

    // Check for active/pending orders that cannot be erased yet
    const activeOrders = await db.query(
      `SELECT id, status, fulfillment_id FROM orders
       WHERE pii_data->>'subject_id' = $1
         AND status NOT IN ('DELIVERED', 'CANCELLED')`,
      [subjectId]
    );

    const deferredOrders: Array<{ id: number; status: string; fulfillmentId: string }> = [];
    if (activeOrders.rows.length > 0) {
      for (const row of activeOrders.rows) {
        deferredOrders.push({
          id: row.id,
          status: row.status,
          fulfillmentId: row.fulfillment_id,
        });
      }
    }

    // Scrub PII from delivered/cancelled orders (immediate)
    const ordersResult = await db.query(
      `UPDATE orders
       SET pii_data = jsonb_build_object(
         'region', pii_data->'region',
         'product', pii_data->'product',
         'erasure_requested', to_jsonb($2::text),
         'erased_at', to_jsonb($3::text)
       ),
       updated_at = NOW()
       WHERE pii_data->>'subject_id' = $1
         AND status IN ('DELIVERED', 'CANCELLED')
       RETURNING id`,
      [subjectId, "true", timestamp]
    );
    if (ordersResult.rowCount && ordersResult.rowCount > 0) {
      tablesAffected.push("orders");
      totalRowsAffected += ordersResult.rowCount;
    }

    // Mark active orders for deferred erasure
    if (deferredOrders.length > 0) {
      await db.query(
        `UPDATE orders
         SET pii_data = pii_data || jsonb_build_object(
           'erasure_requested', to_jsonb($2::text),
           'erasure_deferred_until', 'fulfillment_complete_plus_30_days'
         ),
         updated_at = NOW()
         WHERE pii_data->>'subject_id' = $1
           AND status NOT IN ('DELIVERED', 'CANCELLED')`,
        [subjectId, "true"]
      );
    }

    // Delete from creators table
    const creatorsResult = await db.query(
      `DELETE FROM creators WHERE handle = $1 RETURNING id`,
      [subjectId]
    );
    if (creatorsResult.rowCount && creatorsResult.rowCount > 0) {
      tablesAffected.push("creators");
      totalRowsAffected += creatorsResult.rowCount;
    }

    // Delete from collaborations
    const collabResult = await db.query(
      `DELETE FROM collaborations WHERE creator_id = $1 RETURNING id`,
      [subjectId]
    );
    if (collabResult.rowCount && collabResult.rowCount > 0) {
      tablesAffected.push("collaborations");
      totalRowsAffected += collabResult.rowCount;
    }

    // Delete from sample_decisions
    const samplesResult = await db.query(
      `DELETE FROM sample_decisions WHERE creator_id = $1 RETURNING id`,
      [subjectId]
    );
    if (samplesResult.rowCount && samplesResult.rowCount > 0) {
      tablesAffected.push("sample_decisions");
      totalRowsAffected += samplesResult.rowCount;
    }

    // Delete from creator_product_matches
    const matchesResult = await db.query(
      `DELETE FROM creator_product_matches WHERE creator_id = $1 RETURNING id`,
      [subjectId]
    );
    if (matchesResult.rowCount && matchesResult.rowCount > 0) {
      tablesAffected.push("creator_product_matches");
      totalRowsAffected += matchesResult.rowCount;
    }

    // Log the erasure event for audit
    await logActivity(db, "gdpr_erasure", {
      subjectId,
      tablesAffected,
      totalRowsAffected,
      deferredOrders: deferredOrders.length,
      timestamp,
    });

    return NextResponse.json({
      success: true,
      subjectId,
      tablesAffected,
      totalRowsAffected,
      deferredOrders:
        deferredOrders.length > 0
          ? {
              count: deferredOrders.length,
              message:
                "These orders have active fulfillment. PII will be erased 30 days after delivery per the PII lifecycle policy.",
              orders: deferredOrders,
            }
          : null,
      timestamp,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
