/**
 * Content Approval Interface — Non-Negotiable Rule #1
 *
 * Dedicated UI for content brief approval. Shows:
 * - Viral trend that triggered the brief (hook, engagement stats)
 * - Product alignment (which Andinn Organics product)
 * - Full brief with regulatory annotations inline
 * - 4-step pipeline results visible
 * - Owner: approve, reject (with reason), or edit
 */

import { getPool } from "@/lib/db/pool";
import { getPendingBriefs, ContentBriefRow } from "@/lib/dashboard/queries";
import { ApprovalActions } from "./approval-actions";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  let briefs: ContentBriefRow[] = [];
  let dbError: string | null = null;

  try {
    const db = getPool();
    briefs = await getPendingBriefs(db);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database connection failed";
  }

  return (
    <div>
      <h1 style={{ fontSize: "1.3rem", marginBottom: "0.5rem" }}>
        Content Approvals
      </h1>
      <p style={{ color: "#888", fontSize: "0.85rem", marginBottom: "1rem" }}>
        No content brief reaches a creator without owner approval.
      </p>

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

      {briefs.length === 0 ? (
        <p style={{ color: "#666" }}>No briefs pending approval.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {briefs.map((brief) => (
            <BriefCard key={brief.id} brief={brief} />
          ))}
        </div>
      )}
    </div>
  );
}

function BriefCard({ brief }: { brief: ContentBriefRow }) {
  const trend = brief.trendData as Record<string, unknown>;
  const product = brief.productData as Record<string, unknown>;
  const regulatory = brief.regulatoryCheck as Record<string, unknown>;
  const creative = brief.creativeGuards as Record<string, unknown>;

  return (
    <div
      style={{
        border: "1px solid #333",
        borderRadius: "8px",
        padding: "1.25rem",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "1rem",
        }}
      >
        <span style={{ fontWeight: 600 }}>Brief {brief.briefId}</span>
        <span style={{ color: "#666", fontSize: "0.8rem" }}>
          {brief.createdAt.toLocaleString()}
        </span>
      </div>

      {/* Pipeline results */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        <PipelineStep
          step="1. Trend Match"
          content={
            trend.hookType
              ? `${String(trend.hookType)}: ${String(trend.hookDescription ?? "")}`
              : "No trend data"
          }
          stats={trend.engagementStats as Record<string, number> | undefined}
        />
        <PipelineStep
          step="2. Product Alignment"
          content={
            product.productName
              ? `${String(product.productName)} — ${String(product.alignmentReason ?? "")}`
              : "No product data"
          }
        />
        <PipelineStep
          step="3. Regulatory Check"
          content={
            regulatory.passed === true
              ? `PASSED — ${(regulatory.capRulesChecked as string[])?.length ?? 0} rules checked`
              : regulatory.passed === false
                ? `FAILED — ${(regulatory.strippedClaims as string[])?.length ?? 0} claims stripped`
                : "No check data"
          }
          isPass={regulatory.passed as boolean | undefined}
        />
        <PipelineStep
          step="4. Creative Guards"
          content={
            creative.approvedHashtags
              ? `${(creative.approvedHashtags as string[]).length} hashtags, ${(creative.trendingAudio as unknown[])?.length ?? 0} audio`
              : "No creative data"
          }
        />
      </div>

      {/* Authorized claims (regulatory annotations) */}
      {Array.isArray(regulatory.authorizedClaims) &&
        (regulatory.authorizedClaims as string[]).length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <div
              style={{
                fontSize: "0.75rem",
                color: "#888",
                marginBottom: "0.25rem",
                textTransform: "uppercase",
              }}
            >
              Authorized Health Claims (Regulatory Annotations)
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.25rem",
              }}
            >
              {(regulatory.authorizedClaims as string[]).map((claim, i) => (
                <span
                  key={i}
                  style={{
                    padding: "2px 8px",
                    background: "#1a3a2a",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    color: "#88cc88",
                  }}
                >
                  {claim.slice(0, 80)}
                  {claim.length > 80 ? "..." : ""}
                </span>
              ))}
            </div>
          </div>
        )}

      {/* Full brief text */}
      <div style={{ marginBottom: "1rem" }}>
        <div
          style={{
            fontSize: "0.75rem",
            color: "#888",
            marginBottom: "0.25rem",
            textTransform: "uppercase",
          }}
        >
          Brief Content
        </div>
        <div
          style={{
            padding: "0.75rem",
            background: "#111",
            borderRadius: "4px",
            fontSize: "0.9rem",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {brief.briefText || "No brief text generated."}
        </div>
      </div>

      {/* Target creators */}
      {brief.targetCreatorIds.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#888",
              marginBottom: "0.25rem",
            }}
          >
            Target Creators: {brief.targetCreatorIds.join(", ")}
          </div>
        </div>
      )}

      {/* Actions */}
      <ApprovalActions briefId={brief.briefId} />
    </div>
  );
}

function PipelineStep({
  step,
  content,
  stats,
  isPass,
}: {
  step: string;
  content: string;
  stats?: Record<string, number>;
  isPass?: boolean;
}) {
  return (
    <div
      style={{
        padding: "0.5rem",
        background: "#111",
        borderRadius: "4px",
        borderTop: `2px solid ${isPass === true ? "#4a8" : isPass === false ? "#a44" : "#555"}`,
      }}
    >
      <div
        style={{ fontSize: "0.7rem", color: "#888", marginBottom: "0.25rem" }}
      >
        {step}
      </div>
      <div style={{ fontSize: "0.8rem" }}>{content}</div>
      {stats && (
        <div style={{ fontSize: "0.7rem", color: "#666", marginTop: "0.25rem" }}>
          {Object.entries(stats)
            .map(([k, v]) => `${k}: ${v.toLocaleString()}`)
            .join(" | ")}
        </div>
      )}
    </div>
  );
}
