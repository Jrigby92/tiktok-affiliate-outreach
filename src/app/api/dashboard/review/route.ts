/**
 * HITL Review Queue API — process review decisions
 * Decisions fed back to LangSmith as evaluation data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { updateReviewDecision, logActivity } from "@/lib/dashboard/queries";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { reviewId, decision, notes } = body;

    if (!reviewId || !decision) {
      return NextResponse.json(
        { error: "reviewId and decision are required" },
        { status: 400 }
      );
    }

    if (!["approved", "rejected", "edited"].includes(decision)) {
      return NextResponse.json(
        { error: "decision must be approved, rejected, or edited" },
        { status: 400 }
      );
    }

    const db = getPool();
    await updateReviewDecision(db, reviewId, decision, notes);

    // Log the decision as agent activity
    await logActivity(db, `review_${decision}`, {
      reviewId,
      decision,
      notes: notes || null,
    });

    // In production: feed decision to LangSmith as evaluation data
    // await langsmith.createFeedback({ runId, score, comment: notes });

    return NextResponse.json({ success: true, reviewId, decision });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
