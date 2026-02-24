/**
 * HITL Review Queue — displays <95% confidence outputs with full context.
 * Server Component.
 *
 * Shows: generated text, retrieved regulatory chunks, judge verdict
 * (Faithfulness/Prohibited Terms/Dosage Accuracy), confidence score,
 * which rule(s) triggered the flag.
 *
 * Owner: approve (send with delay), reject (discard, log reason), edit.
 */

import { getPool } from "@/lib/db/pool";
import { getPendingReviews, ReviewQueueRow } from "@/lib/dashboard/queries";
import { ReviewActions } from "./review-actions";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  let reviews: ReviewQueueRow[] = [];
  let dbError: string | null = null;

  try {
    const db = getPool();
    reviews = await getPendingReviews(db);
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Database connection failed";
  }

  return (
    <div>
      <h1 style={{ fontSize: "1.3rem", marginBottom: "0.5rem" }}>
        HITL Review Queue
      </h1>
      <p style={{ color: "#888", fontSize: "0.85rem", marginBottom: "1rem" }}>
        Outputs scoring &lt;95% confidence are held for human review.
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

      {reviews.length === 0 ? (
        <p style={{ color: "#666" }}>No items pending review.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: ReviewQueueRow }) {
  const verdict = review.judgeVerdict as Record<string, unknown>;
  const faithfulness = verdict.faithfulness as Record<string, unknown> | undefined;
  const prohibitedTerms = verdict.prohibitedTerms as Record<string, unknown> | undefined;
  const dosageAccuracy = verdict.dosageAccuracy as Record<string, unknown> | undefined;

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
        <div>
          <span style={{ fontWeight: 600 }}>Review {review.reviewId}</span>
          <span
            style={{
              marginLeft: "0.75rem",
              padding: "2px 8px",
              borderRadius: "4px",
              fontSize: "0.8rem",
              background:
                review.confidenceScore >= 95 ? "#1a3a2a" : "#3a2a1a",
              color:
                review.confidenceScore >= 95 ? "#88cc88" : "#ccaa66",
            }}
          >
            {review.confidenceScore.toFixed(1)}% confidence
          </span>
        </div>
        <span style={{ color: "#666", fontSize: "0.8rem" }}>
          {review.createdAt.toLocaleString()}
        </span>
      </div>

      {/* Generated text */}
      <div style={{ marginBottom: "1rem" }}>
        <div
          style={{
            fontSize: "0.75rem",
            color: "#888",
            marginBottom: "0.25rem",
            textTransform: "uppercase",
          }}
        >
          Generated Text
        </div>
        <div
          style={{
            padding: "0.75rem",
            background: "#111",
            borderRadius: "4px",
            fontSize: "0.9rem",
            lineHeight: 1.5,
          }}
        >
          {review.contentText}
        </div>
      </div>

      {/* Triggered rules */}
      {review.triggeredRules.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#888",
              marginBottom: "0.25rem",
              textTransform: "uppercase",
            }}
          >
            Triggered Rules
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {review.triggeredRules.map((rule) => (
              <span
                key={rule}
                style={{
                  padding: "2px 8px",
                  background: "#3a1c1c",
                  borderRadius: "4px",
                  fontSize: "0.8rem",
                  color: "#ff9999",
                }}
              >
                Rule {rule}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Judge verdict */}
      <div style={{ marginBottom: "1rem" }}>
        <div
          style={{
            fontSize: "0.75rem",
            color: "#888",
            marginBottom: "0.25rem",
            textTransform: "uppercase",
          }}
        >
          Judge Verdict (Claude 4.5 Haiku)
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "0.5rem",
          }}
        >
          <VerdictItem
            label="Faithfulness"
            pass={faithfulness?.pass as boolean | undefined}
            reasoning={faithfulness?.reasoning as string | undefined}
          />
          <VerdictItem
            label="Prohibited Terms"
            pass={prohibitedTerms?.pass as boolean | undefined}
            reasoning={prohibitedTerms?.reasoning as string | undefined}
          />
          <VerdictItem
            label="Dosage Accuracy"
            pass={dosageAccuracy?.pass as boolean | undefined}
            reasoning={dosageAccuracy?.reasoning as string | undefined}
          />
        </div>
      </div>

      {/* Retrieved chunks */}
      {review.retrievedChunks.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <div
            style={{
              fontSize: "0.75rem",
              color: "#888",
              marginBottom: "0.25rem",
              textTransform: "uppercase",
            }}
          >
            Retrieved Regulatory Context ({review.retrievedChunks.length} chunks)
          </div>
          <div
            style={{
              maxHeight: "150px",
              overflow: "auto",
              padding: "0.5rem",
              background: "#111",
              borderRadius: "4px",
              fontSize: "0.8rem",
              color: "#999",
            }}
          >
            {review.retrievedChunks.map((chunk, i) => (
              <div key={i} style={{ marginBottom: "0.5rem" }}>
                <span style={{ color: "#666" }}>
                  [{String((chunk as Record<string, unknown>).sourceAuthority || "?")}]
                </span>{" "}
                {String(
                  (chunk as Record<string, unknown>).text ?? JSON.stringify(chunk)
                ).slice(0, 200)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <ReviewActions reviewId={review.reviewId} />
    </div>
  );
}

function VerdictItem({
  label,
  pass,
  reasoning,
}: {
  label: string;
  pass?: boolean;
  reasoning?: string;
}) {
  return (
    <div
      style={{
        padding: "0.5rem",
        background: "#111",
        borderRadius: "4px",
        borderLeft: `3px solid ${pass === true ? "#4a8" : pass === false ? "#a44" : "#555"}`,
      }}
    >
      <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{label}</div>
      <div
        style={{
          fontSize: "0.75rem",
          color: pass === true ? "#88cc88" : pass === false ? "#ff9999" : "#888",
        }}
      >
        {pass === true ? "PASS" : pass === false ? "FAIL" : "N/A"}
      </div>
      {reasoning && (
        <div
          style={{
            fontSize: "0.7rem",
            color: "#666",
            marginTop: "0.25rem",
          }}
        >
          {reasoning.slice(0, 100)}
        </div>
      )}
    </div>
  );
}
