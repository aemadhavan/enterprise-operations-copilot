"use client";

import React, { useEffect, useState } from "react";
import { formatRoleLabel } from "@/app/components/DraftCard";
import { Timeline } from "@/app/components/Timeline";
import type { RequestTimeline } from "@/lib/workflow/engine";

export const APPROVER_ROLES = [
  {
    role: "sponsor",
    label: "Sponsor (Line Manager)",
    defaultApprover: "Tom Gallagher",
  },
  {
    role: "data_owner",
    label: "Data Owner",
    defaultApprover: "Tom Gallagher / Mei Lin Tan / Sofia Reyes",
  },
  {
    role: "security_governance",
    label: "Security Governance",
    defaultApprover: "Priya Nair",
  },
  {
    role: "privacy_officer",
    label: "Privacy Officer",
    defaultApprover: "Daniel Okafor",
  },
  {
    role: "head_of_security_governance",
    label: "Head of Security Governance",
    defaultApprover: "Priya Nair",
  },
  {
    role: "finance_systems_lead",
    label: "Finance Systems Lead",
    defaultApprover: "Sofia Reyes",
  },
] as const;

export function buildSimulatedApproverInit(payload: {
  request_id: string;
  role: string;
  decision: "approve" | "reject";
  actor?: string;
}): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-approver-panel": "1",
    },
    body: JSON.stringify(payload),
  };
}

export default function ApproverPanelPage() {
  const [requestId, setRequestId] = useState("AR-0001");
  const [timeline, setTimeline] = useState<RequestTimeline | null>(null);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const param = new URLSearchParams(window.location.search).get("request_id")?.trim();
    if (param) {
      setRequestId(param);
      void fetchTimeline(param);
    }
  }, []);

  async function fetchTimeline(targetId = requestId) {
    const trimmed = targetId.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${encodeURIComponent(trimmed)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? `Request ${trimmed} not found`);
        setTimeline(null);
        return;
      }
      setTimeline(data as RequestTimeline);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load request timeline");
    } finally {
      setLoading(false);
    }
  }

  async function sendDecision(role: string, decision: "approve" | "reject") {
    const trimmed = requestId.trim();
    if (!trimmed) {
      setError("Enter a request_id (e.g. AR-0001) first.");
      return;
    }
    setBusyRole(`${role}:${decision}`);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        "/api/simulated-approver",
        buildSimulatedApproverInit({
          request_id: trimmed,
          role,
          decision,
        }),
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? `Decision failed (${res.status})`);
        return;
      }
      setTimeline(data as RequestTimeline);
      setNotice(
        `Recorded ${decision.toUpperCase()} for ${formatRoleLabel(role)} on ${trimmed}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusyRole(null);
    }
  }

  return (
    <main className="page-container" data-testid="simulated-approver-page">
      <header className="chat-header">
        <div>
          <div className="title-row">
            <h1>Simulated Approver Panel</h1>
            <span
              className="badge badge-simulated"
              title="UI-only simulated organisational approver panel (FR-024a)"
            >
              SIMULATED
            </span>
          </div>
          <p className="subtitle">
            Kestrel Financial Group · Resumes organisational approval hooks outside the AI agent
            tool context (sends <code>x-approver-panel: 1</code>)
          </p>
        </div>
        <nav className="mode-controls" aria-label="Page navigation">
          <a href="/" className="nav-pill-link">
            ← Copilot Chat
          </a>
          <a href="/audit" className="nav-pill-link">
            Audit Log
          </a>
        </nav>
      </header>

      <section className="panel-card" aria-label="Target access request">
        <form
          className="chat-form"
          style={{ borderTop: "none", paddingTop: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            void fetchTimeline(requestId);
          }}
        >
          <label htmlFor="approver-request-id" className="mode-label" style={{ alignSelf: "center" }}>
            Request ID:
          </label>
          <input
            id="approver-request-id"
            type="text"
            className="chat-input"
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            placeholder="e.g. AR-0001"
          />
          <button type="submit" className="chat-submit" disabled={loading || !requestId.trim()}>
            {loading ? "Loading…" : "Load Request"}
          </button>
        </form>

        {error && (
          <div className="msg-error" role="alert" data-testid="approver-error">
            {error}
          </div>
        )}
        {notice && (
          <div
            className="draft-warning draft-policy-warning"
            role="status"
            data-testid="approver-notice"
          >
            {notice}
          </div>
        )}
      </section>

      <section className="panel-card" aria-label="Organisational approver role buttons">
        <div className="draft-card-header">
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>
            Act as Organisational Approver (One Button per Role)
          </h2>
          <span className="badge badge-route">Header: x-approver-panel: 1</span>
        </div>
        <div className="role-buttons-grid" data-testid="approver-role-grid">
          {APPROVER_ROLES.map((item) => {
            const matchingStep = timeline?.steps.find((s) => s.role === item.role);
            const approverDisplay = matchingStep?.approver_name ?? item.defaultApprover;
            const isBusy = busyRole !== null;

            return (
              <div
                key={item.role}
                className="role-card"
                data-testid={`approver-role-card-${item.role}`}
              >
                <div>
                  <strong>{item.label}</strong>
                  <div className="subtitle">
                    <code>{item.role}</code> · {approverDisplay}
                  </div>
                </div>
                {matchingStep && (
                  <div>
                    <span className={`badge badge-step-${matchingStep.status}`}>
                      Step {matchingStep.seq}: {matchingStep.status.toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="draft-actions">
                  <button
                    type="button"
                    className="btn-submit-request"
                    data-testid={`approve-role-${item.role}`}
                    disabled={isBusy}
                    onClick={() => void sendDecision(item.role, "approve")}
                  >
                    Approve as {item.label}
                  </button>
                  <button
                    type="button"
                    className="btn-cancel-draft"
                    data-testid={`reject-role-${item.role}`}
                    disabled={isBusy}
                    onClick={() => void sendDecision(item.role, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {timeline && (
        <Timeline
          timeline={timeline}
          refreshing={loading}
          onRefresh={() => fetchTimeline(timeline.request_id)}
        />
      )}
    </main>
  );
}
