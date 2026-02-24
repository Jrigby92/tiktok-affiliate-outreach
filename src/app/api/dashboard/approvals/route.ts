/**
 * Content Approval API — Non-Negotiable Rule #1
 * Processes approve/reject/edit actions on content briefs.
 * Only after approval does the brief reach the creator.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { updateBriefStatus, logActivity } from "@/lib/dashboard/queries";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { briefId, action, reason, editedText } = body;

    if (!briefId || !action) {
      return NextResponse.json(
        { error: "briefId and action are required" },
        { status: 400 }
      );
    }

    if (!["approved", "rejected", "edited"].includes(action)) {
      return NextResponse.json(
        { error: "action must be approved, rejected, or edited" },
        { status: 400 }
      );
    }

    const db = getPool();

    if (action === "approved") {
      await updateBriefStatus(db, briefId, "approved");
      // In production: deliver the brief via the delay layer
      // const delayLayer = new InfluencerDelayLayer();
      // await delayLayer.scheduleMessage("brief_delivery", creatorId, briefText);
    } else if (action === "rejected") {
      await updateBriefStatus(db, briefId, "rejected", reason);
    } else if (action === "edited") {
      await updateBriefStatus(db, briefId, "edited", editedText);
      // In production: re-run edited text through compliance engine
      // const compliance = new ComplianceEngine(db);
      // await compliance.evaluate(editedText);
    }

    await logActivity(db, `brief_${action}`, {
      briefId,
      action,
      reason: reason || null,
    });

    return NextResponse.json({ success: true, briefId, action });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
