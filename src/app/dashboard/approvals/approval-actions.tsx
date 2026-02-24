"use client";

import { useState } from "react";

export function ApprovalActions({ briefId }: { briefId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [message, setMessage] = useState("");

  async function handleAction(
    action: "approved" | "rejected" | "edited"
  ) {
    setStatus("loading");
    try {
      const body: Record<string, string> = { briefId, action };
      if (action === "rejected") {
        const reason = prompt("Rejection reason:");
        if (!reason) {
          setStatus("idle");
          return;
        }
        body.reason = reason;
      }
      if (action === "edited") {
        const editedText = prompt("Enter edited brief text:");
        if (!editedText) {
          setStatus("idle");
          return;
        }
        body.editedText = editedText;
      }
      const res = await fetch("/api/dashboard/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage(`Brief ${action} successfully`);
      setStatus("done");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Action failed");
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div
        style={{
          padding: "0.5rem",
          background: "#1a3a2a",
          borderRadius: "4px",
          color: "#88cc88",
          fontSize: "0.85rem",
        }}
      >
        {message}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <button
        onClick={() => handleAction("approved")}
        disabled={status === "loading"}
        style={{
          padding: "0.4rem 1rem",
          background: "#1a3a2a",
          color: "#88cc88",
          border: "1px solid #2a5a3a",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "0.85rem",
        }}
      >
        Approve & Send
      </button>
      <button
        onClick={() => handleAction("rejected")}
        disabled={status === "loading"}
        style={{
          padding: "0.4rem 1rem",
          background: "#3a1c1c",
          color: "#ff9999",
          border: "1px solid #5a2222",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "0.85rem",
        }}
      >
        Reject
      </button>
      <button
        onClick={() => handleAction("edited")}
        disabled={status === "loading"}
        style={{
          padding: "0.4rem 1rem",
          background: "#2a2a1a",
          color: "#cccc88",
          border: "1px solid #4a4a22",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "0.85rem",
        }}
      >
        Edit
      </button>
      {status === "loading" && (
        <span style={{ color: "#888", fontSize: "0.8rem" }}>Processing...</span>
      )}
      {message && (
        <span style={{ color: "#ff9999", fontSize: "0.8rem" }}>{message}</span>
      )}
    </div>
  );
}
