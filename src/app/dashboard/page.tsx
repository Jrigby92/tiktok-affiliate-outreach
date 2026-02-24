/**
 * Dashboard Overview — Collaborations overview page
 * Server Component: fetches data directly from PostgreSQL
 */

import { getPool } from "@/lib/db/pool";
import {
  getActiveCollaborations,
  getCollaborationStats,
  getOrderStats,
} from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function DashboardOverview() {
  let stats = { open: 0, target: 0, pending: 0, active: 0 };
  let orderStats = { total: 0, pending: 0, delivered: 0, cancelled: 0 };
  let collaborations: Awaited<ReturnType<typeof getActiveCollaborations>> = [];
  let dbError: string | null = null;

  try {
    const db = getPool();
    [stats, orderStats, collaborations] = await Promise.all([
      getCollaborationStats(db),
      getOrderStats(db),
      getActiveCollaborations(db),
    ]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database connection failed";
  }

  return (
    <div>
      <h1 style={{ fontSize: "1.3rem", marginBottom: "1rem" }}>
        Collaborations Overview
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

      {/* Stats cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <StatCard label="Open Collaborations" value={stats.open} />
        <StatCard label="Target Collaborations" value={stats.target} />
        <StatCard label="Pending" value={stats.pending} />
        <StatCard label="Active" value={stats.active} />
        <StatCard label="Orders Total" value={orderStats.total} />
        <StatCard label="Delivered" value={orderStats.delivered} />
      </div>

      {/* Active collaborations table */}
      <h2
        style={{
          fontSize: "1rem",
          marginBottom: "0.75rem",
          color: "#aaa",
        }}
      >
        Active Collaborations
      </h2>

      {collaborations.length === 0 ? (
        <p style={{ color: "#666" }}>No active collaborations.</p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.85rem",
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid #333",
                textAlign: "left",
                color: "#888",
              }}
            >
              <th style={{ padding: "0.5rem" }}>Creator</th>
              <th style={{ padding: "0.5rem" }}>Type</th>
              <th style={{ padding: "0.5rem" }}>Status</th>
              <th style={{ padding: "0.5rem" }}>Commission</th>
              <th style={{ padding: "0.5rem" }}>Match Score</th>
              <th style={{ padding: "0.5rem" }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {collaborations.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid #222" }}>
                <td style={{ padding: "0.5rem" }}>{c.creatorId}</td>
                <td style={{ padding: "0.5rem" }}>
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: "4px",
                      background: c.type === "target" ? "#1a3a2a" : "#1a2a3a",
                      fontSize: "0.8rem",
                    }}
                  >
                    {c.type}
                  </span>
                </td>
                <td style={{ padding: "0.5rem" }}>{c.status}</td>
                <td style={{ padding: "0.5rem" }}>
                  {c.commissionConfig.flatRate
                    ? `${String(c.commissionConfig.flatRate)}%`
                    : String(c.commissionConfig.type || "—")}
                </td>
                <td style={{ padding: "0.5rem" }}>
                  {c.matchScore != null ? c.matchScore.toFixed(1) : "—"}
                </td>
                <td style={{ padding: "0.5rem", color: "#888" }}>
                  {c.createdAt.toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #333",
        borderRadius: "6px",
      }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: "0.8rem", color: "#888" }}>{label}</div>
    </div>
  );
}
