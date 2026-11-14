"use client";

import React, { useEffect, useState } from "react";
import type { AuditRow } from "@/lib/audit/audit";

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [requestId, setRequestId] = useState("");
  const [draftId, setDraftId] = useState("");
  const [limit, setLimit] = useState("100");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const reqParam = params.get("request_id")?.trim() ?? "";
    const draftParam = params.get("draft_id")?.trim() ?? "";
    if (reqParam) setRequestId(reqParam);
    if (draftParam) setDraftId(draftParam);
    void fetchAudit({ request_id: reqParam, draft_id: draftParam, limit: "100" });
  }, []);

  async function fetchAudit(filters?: { request_id?: string; draft_id?: string; limit?: string }) {
    const reqFilter = (filters?.request_id ?? requestId).trim();
    const draftFilter = (filters?.draft_id ?? draftId).trim();
    const limitFilter = (filters?.limit ?? limit).trim() || "100";

    const search = new URLSearchParams();
    search.set("limit", limitFilter);
    if (reqFilter) search.set("request_id", reqFilter);
    if (draftFilter) search.set("draft_id", draftFilter);

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit?${search.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? `Failed to load audit log (${res.status})`);
        return;
      }
      setRows((data.rows ?? []) as AuditRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-container" data-testid="audit-log-page">
      <header className="chat-header">
        <div>
          <div className="title-row">
            <h1>Append-Only Governance Audit Log</h1>
            <span
              className="badge badge-simulated"
              title="Append-only Postgres audit_log with PII redaction (FR-015, FR-017)"
            >
              SIMULATED
            </span>
          </div>
          <p className="subtitle">
            Kestrel Financial Group · Protected by <code>REVOKE UPDATE, DELETE</code> and a raising
            trigger · Stated actors labelled <code>(unverified)</code>
          </p>
        </div>
        <nav className="mode-controls" aria-label="Page navigation">
          <a href="/" className="nav-pill-link">
            ← Copilot Chat
          </a>
          <a href="/approver" className="nav-pill-link">
            Approver Panel
          </a>
        </nav>
      </header>

      <section className="panel-card" aria-label="Audit filters">
        <form
          className="chat-form"
          style={{ borderTop: "none", paddingTop: 0, flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            void fetchAudit();
          }}
        >
          <input
            type="text"
            className="chat-input"
            placeholder="Filter by request_id (e.g. AR-0001)"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            aria-label="Filter by request ID"
          />
          <input
            type="text"
            className="chat-input"
            placeholder="Filter by draft_id (UUID)"
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            aria-label="Filter by draft ID"
          />
          <input
            type="number"
            min={1}
            max={500}
            className="mode-select"
            style={{ width: "90px" }}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            aria-label="Row limit"
          />
          <button type="submit" className="chat-submit" disabled={loading}>
            {loading ? "Loading…" : "Filter / Refresh"}
          </button>
        </form>

        {error && (
          <div className="msg-error" role="alert" data-testid="audit-error">
            {error}
          </div>
        )}
      </section>

      <section className="panel-card" aria-label="Audit entries">
        <div className="draft-card-header">
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Audit Entries ({rows.length})</h2>
          <span className="badge badge-route">Read-only · PII-redacted</span>
        </div>

        {rows.length === 0 && !loading ? (
          <p className="evidence-muted" data-testid="audit-empty">
            No audit records match the current filter.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="audit-table" data-testid="audit-log-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Timestamp</th>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>Request / Draft</th>
                  <th>Policy Citations</th>
                  <th>Details (Redacted)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`audit-row-${r.id}`}>
                    <td>
                      <code>#{r.id}</code>
                    </td>
                    <td>{new Date(r.at).toISOString()}</td>
                    <td>
                      <span className="badge badge-route">{r.event}</span>
                    </td>
                    <td>{r.actor}</td>
                    <td>
                      {r.request_id && (
                        <div>
                          <code>{r.request_id}</code>
                        </div>
                      )}
                      {r.draft_id && (
                        <div className="subtitle">
                          <code>{r.draft_id.slice(0, 8)}…</code>
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="draft-citations">
                        {(r.policy_citations ?? []).map((cit) => (
                          <span key={cit} className="citation-chip citation-chip-small">
                            {cit}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <code>{JSON.stringify(r.details)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
