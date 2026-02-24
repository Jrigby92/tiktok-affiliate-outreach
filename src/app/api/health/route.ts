import { NextResponse } from "next/server";
import { checkQueueHealth } from "@/lib/queue";

export async function GET() {
  try {
    const health = await checkQueueHealth();
    const healthy = health.redis && Object.values(health.queues).every(Boolean);
    return NextResponse.json({ ...health, healthy }, {
      status: healthy ? 200 : 503,
    });
  } catch (error) {
    return NextResponse.json(
      {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
