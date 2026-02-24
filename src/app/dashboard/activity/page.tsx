/**
 * Agent Activity Feed — real-time log of agent actions
 * Server Component
 */

import { getPool } from "@/lib/db/pool";
import { getRecentActivity, ActivityRow } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  creator_search: "Creator Search",
  collaboration_create: "Collaboration Created",
  sample_approved: "Sample Approved",
  sample_rejected: "Sample Rejected",
  mcf_order: "MCF Order Placed",
  compliance_check: "Compliance Check",
  content_brief: "Content Brief Generated",
  brief_approved: "Brief Approved",
  brief_rejected: "Brief Rejected",
  message_sent: "Message Sent",
  trend_ingested: "Trends Ingested",
  alert_fired: "Alert Fired",
  circuit_breaker: "Circuit Breaker Triggered",
};

export default async function ActivityPage() {
  let activities: ActivityRow[] = [];
  let dbError: string | null = null;

  try {
    const db = getPool();
    activities = await getRecentActivity(db, 100);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database connection failed";
  }

  return (
    <div>
      <h1 style={{ fontSize: "1.3rem", marginBottom: "1rem" }}>
        Agent Activity Feed
      </h1>

      {dbError && (
        <div
          style={{
            padding: "1rem",
            background: "#3a1c1c",
            border: "1px solid #662222",
            borderRadius: "6px",
            marginBottom: "1rem",
            color: "#ff9999",
          }}
        >
          Database unavailable: {dbError}
        </div>
      )}

      {activities.length === 0 ? (
        <p style={{ color: "#666" }}>No agent activity recorded yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {activities.map((a) => (
            <div
              key={a.id}
              style={{
                padding: "0.75rem 1rem",
                border: "1px solid #222",
                borderRadius: "6px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span style={{ fontWeight: 600, marginRight: "0.5rem" }}>
                  {ACTION_LABELS[a.actionType] || a.actionType}
                </span>
                <span
                  style={{
                    fontSize: "0.8rem",
                    padding: "2px 6px",
                    borderRadius: "3px",
                    background:
                      a.status === "completed"
                        ? "#1a3a2a"
                        : a.status === "failed"
                          ? "#3a1c1c"
                          : "#2a2a1a",
                    color:
                      a.status === "completed"
                        ? "#88cc88"
                        : a.status === "failed"
                          ? "#ff9999"
                          : "#cccc88",
                  }}
                >
                  {a.status}
                </span>
                {a.details && Object.keys(a.details).length > 0 && (
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "#666",
                      marginTop: "0.25rem",
                    }}
                  >
                    {JSON.stringify(a.details).slice(0, 120)}
                    {JSON.stringify(a.details).length > 120 ? "..." : ""}
                  </div>
                )}
              </div>
              <div style={{ color: "#666", fontSize: "0.8rem", flexShrink: 0 }}>
                {a.createdAt.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
