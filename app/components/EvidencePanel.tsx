"use client";

import React from "react";
import type { Citation, Claim, Confidence, Route } from "@/lib/agent/schemas";

export interface PathNode {
  id: string;
  label: string;
  name: string;
  classification: string | null;
}

export interface PathEdge {
  source: string;
  relation: string;
  target: string;
  condition: string | null;
  source_doc: string | null;
}

export interface ChatTurnResponse {
  conversation_id?: string;
  route: Route;
  intent: string;
  risk: string;
  mode: "graphrag" | "baseline";
  answer: {
    markdown: string;
    claims: Claim[];
    assumptions: string[];
    gaps: string[];
    confidence: Confidence;
    behaviour: string;
    legitimate_path: string | null;
    clarifying_question: string | null;
  };
  citations: Citation[];
  graph_path: {
    nodes: PathNode[];
    edges: PathEdge[];
  };
  tool_calls?: { name: string; input: unknown; ok: boolean; ms: number }[];
  draft: unknown;
  trace_id: string | null;
  latency_ms: number;
  cost_usd: number;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Format a citation into a concise human-readable label and target doc ID. */
export function formatCitationChip(c: Citation): {
  label: string;
  docId: string;
  anchor: string;
  isEdge: boolean;
} {
  if ("edge" in c) {
    const { source, relation, target, source_doc } = c.edge;
    return {
      label: `${source} ─${relation}→ ${target} (${source_doc})`,
      docId: source_doc,
      anchor: `#source-${encodeURIComponent(source_doc)}`,
      isEdge: true,
    };
  }
  const lastSeg = c.section.split(" > ").pop() ?? c.section;
  const numMatch = lastSeg.match(/^(\d+(?:\.\d+)*)/);
  const shortSec = numMatch ? numMatch[1] : lastSeg;
  return {
    label: `${c.doc_id} §${shortSec}`,
    docId: c.doc_id,
    anchor: `#source-${encodeURIComponent(c.doc_id)}`,
    isEdge: false,
  };
}

/** Deduplicated list of cited sources for the Sources section of the Evidence Panel. */
export function extractSourceItems(
  citations: Citation[],
  edges: PathEdge[],
): { key: string; docId: string; detail: string }[] {
  const map = new Map<string, { key: string; docId: string; detail: string }>();
  for (const c of citations) {
    if ("edge" in c) {
      const k = `${c.edge.source_doc}|edge:${c.edge.source}->${c.edge.target}`;
      if (!map.has(k)) {
        map.set(k, {
          key: k,
          docId: c.edge.source_doc,
          detail: `${c.edge.source} ─${c.edge.relation}→ ${c.edge.target}`,
        });
      }
    } else {
      const k = `${c.doc_id}|${c.section}`;
      if (!map.has(k)) {
        map.set(k, {
          key: k,
          docId: c.doc_id,
          detail: `§ ${c.section}`,
        });
      }
    }
  }
  for (const e of edges) {
    if (!e.source_doc) continue;
    const k = `${e.source_doc}|edge:${e.source}->${e.target}`;
    if (!map.has(k)) {
      map.set(k, {
        key: k,
        docId: e.source_doc,
        detail: `${e.source} ─${e.relation}→ ${e.target}`,
      });
    }
  }
  return [...map.values()];
}

export function routeDisplayLabel(route: Route, mode: "graphrag" | "baseline"): string {
  if (mode === "baseline") return `${route} (baseline)`;
  switch (route) {
    case "graph_traversal":
      return "GraphRAG (graph_traversal)";
    case "graph_local":
      return "GraphRAG (graph_local)";
    case "text":
      return "Hybrid Text (text)";
    default:
      return route;
  }
}

export interface EvidencePanelProps {
  turn: ChatTurnResponse | null;
}

export function EvidencePanel({ turn }: EvidencePanelProps) {
  if (!turn) {
    return (
      <aside className="evidence-panel" aria-label="Evidence panel">
        <div className="evidence-header">
          <h2>Evidence</h2>
          <span className="badge badge-simulated" title="All tools and data are synthetic mocks">
            SIMULATED
          </span>
        </div>
        <p className="evidence-empty">
          Ask a policy or access-impact question to inspect the route, confidence, graph traversal
          path, cited sources, assumptions, gaps, latency and cost.
        </p>
      </aside>
    );
  }

  const nodeNames = new Map(turn.graph_path.nodes.map((n) => [n.id, n]));
  const formatNodeRef = (id: string) => {
    const n = nodeNames.get(id);
    if (!n) return id;
    return n.classification ? `${n.name} (${n.classification})` : n.name;
  };

  const sources = extractSourceItems(turn.citations, turn.graph_path.edges);
  const latencySec = (turn.latency_ms / 1000).toFixed(2);
  const costFormatted = `$${turn.cost_usd.toFixed(4)}`;

  return (
    <aside className="evidence-panel" aria-label="Evidence panel">
      <div className="evidence-header">
        <h2>Evidence</h2>
        <span className="badge badge-simulated" title="All tools and data are synthetic mocks">
          SIMULATED
        </span>
      </div>

      <section className="evidence-section" aria-label="Turn metadata">
        <div className="meta-grid">
          <div className="meta-item">
            <span className="meta-label">Route</span>
            <span className="badge badge-route" data-testid="evidence-route">
              {turn.route}
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Confidence</span>
            <span
              className={`badge badge-confidence-${turn.answer.confidence}`}
              data-testid="evidence-confidence"
            >
              {turn.answer.confidence.toUpperCase()}
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Intent / Risk</span>
            <span className="meta-value">
              {turn.intent} · <strong className={`risk-${turn.risk}`}>{turn.risk}</strong>
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Mode</span>
            <span className="meta-value">{turn.mode}</span>
          </div>
        </div>
      </section>

      <section className="evidence-section" aria-label="Graph path">
        <h3>Graph path ({turn.graph_path.edges.length} edges)</h3>
        {turn.graph_path.edges.length === 0 ? (
          <p className="evidence-muted">
            {turn.route === "text"
              ? "Text route — hybrid keyword + vector retrieval (no graph traversal)."
              : "No graph edges traversed on this turn."}
          </p>
        ) : (
          <div className="graph-box" data-testid="evidence-graph-path">
            {turn.graph_path.nodes.length > 0 && (
              <div className="graph-nodes">
                {turn.graph_path.nodes.map((n) => (
                  <span key={n.id} className="node-pill" title={`${n.label}: ${n.id}`}>
                    <strong>{n.name}</strong>{" "}
                    <span className="node-id">
                      ({n.id}
                      {n.classification ? ` · ${n.classification}` : ""})
                    </span>
                  </span>
                ))}
              </div>
            )}
            <ul className="graph-edge-list">
              {turn.graph_path.edges.map((e, i) => (
                <li key={`${e.source}-${e.relation}-${e.target}-${i}`} className="graph-edge-item">
                  <span className="edge-node">{formatNodeRef(e.source)}</span>{" "}
                  <span className="edge-rel">─{e.relation}→</span>{" "}
                  <span className="edge-node">{formatNodeRef(e.target)}</span>
                  {e.condition && <span className="edge-cond">[{e.condition}]</span>}
                  {e.source_doc && (
                    <a
                      href={`#source-${encodeURIComponent(e.source_doc)}`}
                      className="citation-chip citation-chip-small"
                    >
                      {e.source_doc}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="evidence-section" id="evidence-sources" aria-label="Cited sources">
        <h3>Sources ({sources.length})</h3>
        {sources.length === 0 ? (
          <p className="evidence-muted">—</p>
        ) : (
          <ul className="source-list" data-testid="evidence-sources-list">
            {sources.map((s) => (
              <li key={s.key} id={`source-${s.docId}`} className="source-item">
                <a
                  href={`#source-${encodeURIComponent(s.docId)}`}
                  className="citation-chip"
                  title={`Source document ${s.docId}`}
                >
                  {s.docId}
                </a>
                <span className="source-detail">{s.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="evidence-section" aria-label="Assumptions">
        <h3>Assumptions</h3>
        {turn.answer.assumptions.length === 0 ? (
          <p className="evidence-muted">—</p>
        ) : (
          <ul className="evidence-list" data-testid="evidence-assumptions">
            {turn.answer.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="evidence-section" aria-label="Gaps">
        <h3>Gaps</h3>
        {turn.answer.gaps.length === 0 ? (
          <p className="evidence-muted" data-testid="evidence-gaps">
            none
          </p>
        ) : (
          <ul className="evidence-list" data-testid="evidence-gaps">
            {turn.answer.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        )}
      </section>

      {turn.tool_calls && turn.tool_calls.length > 0 && (
        <section className="evidence-section" aria-label="Tool calls">
          <h3>MCP Tool Calls ({turn.tool_calls.length})</h3>
          <ul className="evidence-list">
            {turn.tool_calls.map((tc, i) => (
              <li key={i}>
                <code>{tc.name}</code> — {tc.ok ? "ok" : "error"} ({tc.ms} ms)
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="evidence-footer" data-testid="evidence-telemetry">
        {turn.trace_id ? (
          <a
            href={`#trace-${encodeURIComponent(turn.trace_id)}`}
            className="trace-link"
            title={`Trace ID: ${turn.trace_id}`}
          >
            Trace ▸ ({turn.trace_id.slice(0, 8)})
          </a>
        ) : (
          <a href="#evidence-telemetry" className="trace-link" title="Langfuse trace">
            Trace ▸
          </a>
        )}
        <span className="telemetry-stats">
          Cost <strong>{costFormatted}</strong> · <strong>{latencySec}s</strong> ({turn.latency_ms}{" "}
          ms)
        </span>
      </footer>
    </aside>
  );
}

