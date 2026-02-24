/**
 * Cost Dashboard — LLM token usage and spend per model/session/day
 * Server Component. Data sourced from LangSmith API.
 */

import { getPool } from "@/lib/db/pool";
import { getCostSummary } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function CostDashboard() {
  let costs = {
    totalSpendGBP: 0,
    spendByModel: {} as Record<string, number>,
    spendByDay: [] as { date: string; amount: number }[],
    totalCalls: 0,
  };
  let dbError: string | null = null;

  try {
    const db = getPool();
    costs = await getCostSummary(db);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database connection failed";
  }

  return (
    <div>
      <h1 style={{ fontSize: "1.3rem", marginBottom: "1rem" }}>
        Cost Dashboard
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

      {/* Summary cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            padding: "1rem",
            border: "1px solid #333",
            borderRadius: "6px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            {"\u00A3"}
            {costs.totalSpendGBP.toFixed(2)}
          </div>
          <div style={{ fontSize: "0.8rem", color: "#888" }}>
            Total LLM Spend (GBP)
          </div>
        </div>
        <div
          style={{
            padding: "1rem",
            border: "1px solid #333",
            borderRadius: "6px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            {costs.totalCalls}
          </div>
          <div style={{ fontSize: "0.8rem", color: "#888" }}>Total LLM Calls</div>
        </div>
      </div>

      {/* Spend by model */}
      <h2
        style={{
          fontSize: "1rem",
          marginBottom: "0.75rem",
          color: "#aaa",
        }}
      >
        Spend by Model
      </h2>
      {Object.keys(costs.spendByModel).length === 0 ? (
        <p style={{ color: "#666", marginBottom: "1.5rem" }}>
          No LLM usage data yet. Cost data is sourced from LangSmith once
          tracing is active.
        </p>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.85rem",
            marginBottom: "1.5rem",
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
              <th style={{ padding: "0.5rem" }}>Model</th>
              <th style={{ padding: "0.5rem" }}>Spend (GBP)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(costs.spendByModel).map(([model, amount]) => (
              <tr key={model} style={{ borderBottom: "1px solid #222" }}>
                <td style={{ padding: "0.5rem" }}>{model}</td>
                <td style={{ padding: "0.5rem" }}>
                  {"\u00A3"}
                  {amount.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Daily spend */}
      <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem", color: "#aaa" }}>
        Daily Spend
      </h2>
      {costs.spendByDay.length === 0 ? (
        <p style={{ color: "#666" }}>No daily spend data available.</p>
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
              <th style={{ padding: "0.5rem" }}>Date</th>
              <th style={{ padding: "0.5rem" }}>Spend (GBP)</th>
            </tr>
          </thead>
          <tbody>
            {costs.spendByDay.map((d) => (
              <tr key={d.date} style={{ borderBottom: "1px solid #222" }}>
                <td style={{ padding: "0.5rem" }}>{d.date}</td>
                <td style={{ padding: "0.5rem" }}>
                  {"\u00A3"}
                  {d.amount.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
