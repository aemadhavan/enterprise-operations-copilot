"use client";

import React, { useState } from "react";
import {
  formatCitationChip,
  routeDisplayLabel,
  type ChatTurnResponse,
} from "./EvidencePanel";

export interface CompareToggleProps {
  question: string;
  primaryTurn: ChatTurnResponse;
  baselineTurn?: ChatTurnResponse | null;
  conversationId?: string;
  onSelectTurn?: (turn: ChatTurnResponse) => void;
}

/**
 * "Compare with baseline" side-by-side toggle (T067, US6):
 * Re-runs the question with `mode=baseline` (hybrid keyword + vector retrieval, no graph)
 * and renders a side-by-side comparison against the `graphrag` turn.
 */
export function CompareToggle({
  question,
  primaryTurn,
  baselineTurn: initialBaseline = null,
  conversationId = "compare",
  onSelectTurn,
}: CompareToggleProps) {
  const [open, setOpen] = useState(Boolean(initialBaseline));
  const [baseline, setBaseline] = useState<ChatTurnResponse | null>(initialBaseline);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (baseline || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: `${conversationId}-baseline`,
          message: question,
          mode: "baseline",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? `Baseline run failed (${res.status})`);
        return;
      }
      setBaseline(data as ChatTurnResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run baseline comparison");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="compare-toggle-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="nav-pill-link compare-toggle-btn"
        aria-expanded={open}
        disabled={loading}
        onClick={() => void handleToggle()}
      >
        {loading
          ? "Running baseline comparison…"
          : open
            ? "Hide baseline comparison"
            : "Compare with baseline (hybrid text only)"}
      </button>

      {open && (
        <section
          className="compare-grid"
          aria-label="Side-by-side GraphRAG vs Baseline comparison"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "0.75rem",
            marginTop: "0.75rem",
            padding: "0.75rem",
            borderRadius: "0.5rem",
            border: "1px solid #cbd5e1",
            background: "#f8fafc",
          }}
        >
          <div
            className="compare-col compare-col-graphrag"
            style={{
              padding: "0.65rem",
              borderRadius: "0.375rem",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <strong>GraphRAG (Hybrid + Graph)</strong>
              <span className={`badge badge-confidence-${primaryTurn.answer.confidence}`}>
                {primaryTurn.answer.confidence.toUpperCase()}
              </span>
            </div>
            <p style={{ fontSize: "0.8rem", color: "#475569", margin: "0 0 0.5rem" }}>
              Route: {routeDisplayLabel(primaryTurn.route, primaryTurn.mode)} · Graph edges:{" "}
              {primaryTurn.graph_path.edges.length} · Citations: {primaryTurn.citations.length}
            </p>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
              {primaryTurn.answer.claims.map((c, i) => (
                <li key={i} style={{ marginBottom: "0.35rem" }}>
                  {c.text}{" "}
                  {c.citations.map((cit, ci) => {
                    const chip = formatCitationChip(cit);
                    return (
                      <a
                        key={ci}
                        href={chip.anchor}
                        className="citation-chip"
                        onClick={() => onSelectTurn?.(primaryTurn)}
                      >
                        {chip.label}
                      </a>
                    );
                  })}
                </li>
              ))}
            </ul>
          </div>

          <div
            className="compare-col compare-col-baseline"
            style={{
              padding: "0.65rem",
              borderRadius: "0.375rem",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <strong>Baseline (Hybrid Text Only)</strong>
              {baseline && (
                <span className={`badge badge-confidence-${baseline.answer.confidence}`}>
                  {baseline.answer.confidence.toUpperCase()}
                </span>
              )}
            </div>
            {loading && <p role="status">Running baseline turn (graph tools disabled)…</p>}
            {error && (
              <p className="msg-error" role="alert">
                {error}
              </p>
            )}
            {baseline && (
              <>
                <p style={{ fontSize: "0.8rem", color: "#475569", margin: "0 0 0.5rem" }}>
                  Route: {routeDisplayLabel(baseline.route, baseline.mode)} · Graph edges:{" "}
                  {baseline.graph_path.edges.length} · Citations: {baseline.citations.length}
                </p>
                {baseline.answer.claims.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
                    {baseline.answer.claims.map((c, i) => (
                      <li key={i} style={{ marginBottom: "0.35rem" }}>
                        {c.text}{" "}
                        {c.citations.map((cit, ci) => {
                          const chip = formatCitationChip(cit);
                          return (
                            <a
                              key={ci}
                              href={chip.anchor}
                              className="citation-chip"
                              onClick={() => onSelectTurn?.(baseline)}
                            >
                              {chip.label}
                            </a>
                          );
                        })}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ fontSize: "0.85rem" }}>{baseline.answer.markdown}</p>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
