"use client";

import React, { useId, useState } from "react";
import type { DraftRecord } from "@/lib/drafts/drafts";
import type { RequestTimeline } from "@/lib/workflow/engine";
import { CompareToggle } from "./components/CompareToggle";
import { DraftCard } from "./components/DraftCard";
import {
  EvidencePanel,
  formatCitationChip,
  routeDisplayLabel,
  type ChatTurnResponse,
} from "./components/EvidencePanel";
import { Timeline } from "./components/Timeline";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  question?: string;
  turn?: ChatTurnResponse;
  error?: string;
}

const SAMPLE_QUESTIONS = [
  {
    id: "GS-001",
    label: "GS-001 (Direct lookup)",
    question: "What is the maximum duration for contractor access to customer PII?",
  },
  {
    id: "GS-009",
    label: "GS-009 (Hero multi-hop)",
    question:
      "A contractor needs read access to Atlas CRM. What approvals and controls are required?",
  },
  {
    id: "GS-022",
    label: "GS-022 (Draft action)",
    question:
      "Raise an access request for contractor Alex Chen, sponsored by Tom Gallagher, for read access to Atlas CRM for 60 days to support a customer-churn analysis.",
  },
];

export default function Home() {
  const convId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"graphrag" | "baseline">("graphrag");
  const [loading, setLoading] = useState(false);
  const [selectedTurn, setSelectedTurn] = useState<ChatTurnResponse | null>(null);
  const [draftsById, setDraftsById] = useState<Record<string, DraftRecord>>({});
  const [timelinesByDraftId, setTimelinesByDraftId] = useState<Record<string, RequestTimeline>>({});
  const [draftBusyById, setDraftBusyById] = useState<Record<string, boolean>>({});
  const [draftErrorById, setDraftErrorById] = useState<Record<string, string | null>>({});

  async function sendQuestion(questionText: string, overrideMode?: "graphrag" | "baseline") {
    const trimmed = questionText.trim();
    if (!trimmed || loading) return;
    const activeMode = overrideMode ?? mode;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_id: convId,
          message: trimmed,
          mode: activeMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errMsg = data?.error?.message ?? `Request failed with status ${res.status}`;
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", text: "", error: errMsg },
        ]);
        return;
      }

      const turn = data as ChatTurnResponse;
      if (turn.draft) {
        const d = turn.draft;
        setDraftsById((prev) => ({ ...prev, [d.draft_id]: d }));
      }
      setSelectedTurn(turn);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: turn.answer.markdown,
          question: trimmed,
          turn,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: "",
          error: err instanceof Error ? err.message : "Network error",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function refreshTimeline(draftId: string, requestId: string) {
    try {
      const res = await fetch(`/api/requests/${encodeURIComponent(requestId)}`);
      if (!res.ok) return;
      const timeline = (await res.json()) as RequestTimeline;
      setTimelinesByDraftId((prev) => ({ ...prev, [draftId]: timeline }));
    } catch {
      // Keep last known timeline on transient polling errors.
    }
  }

  async function handleConfirmDraft(draft: DraftRecord) {
    const draftId = draft.draft_id;
    setDraftBusyById((prev) => ({ ...prev, [draftId]: true }));
    setDraftErrorById((prev) => ({ ...prev, [draftId]: null }));
    try {
      const res = await fetch(`/api/drafts/${encodeURIComponent(draftId)}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed_by: draft.payload.sponsor || "anonymous" }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error?.message ?? `Confirmation failed (${res.status})`;
        setDraftErrorById((prev) => ({ ...prev, [draftId]: msg }));
        return;
      }
      setDraftsById((prev) => ({
        ...prev,
        [draftId]: { ...(prev[draftId] ?? draft), status: "confirmed" },
      }));
      if (typeof data.request_id === "string") {
        await refreshTimeline(draftId, data.request_id);
      }
    } catch (err) {
      setDraftErrorById((prev) => ({
        ...prev,
        [draftId]: err instanceof Error ? err.message : "Failed to submit request",
      }));
    } finally {
      setDraftBusyById((prev) => ({ ...prev, [draftId]: false }));
    }
  }

  async function handleCancelDraft(draft: DraftRecord) {
    const draftId = draft.draft_id;
    setDraftBusyById((prev) => ({ ...prev, [draftId]: true }));
    setDraftErrorById((prev) => ({ ...prev, [draftId]: null }));
    try {
      const res = await fetch(`/api/drafts/${encodeURIComponent(draftId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor: draft.payload.sponsor || "anonymous" }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error?.message ?? `Cancellation failed (${res.status})`;
        setDraftErrorById((prev) => ({ ...prev, [draftId]: msg }));
        return;
      }
      setDraftsById((prev) => ({
        ...prev,
        [draftId]: { ...(prev[draftId] ?? draft), status: "cancelled" },
      }));
    } catch (err) {
      setDraftErrorById((prev) => ({
        ...prev,
        [draftId]: err instanceof Error ? err.message : "Failed to cancel draft",
      }));
    } finally {
      setDraftBusyById((prev) => ({ ...prev, [draftId]: false }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sendQuestion(input);
  }

  return (
    <div className="copilot-shell">
      <main className="chat-column">
        <header className="chat-header">
          <div>
            <div className="title-row">
              <h1>Enterprise Operations Copilot</h1>
              <span
                className="badge badge-simulated"
                title="Synthetic Kestrel Financial Group governance environment"
              >
                SIMULATED
              </span>
            </div>
            <p className="subtitle">
              Kestrel Financial Group · Governed GraphRAG access-impact decision support (synthetic
              data)
            </p>
          </div>
          <div className="mode-controls" role="group" aria-label="Retrieval mode and navigation">
            <a href="/approver" className="nav-pill-link">
              Approver Panel
            </a>
            <a href="/audit" className="nav-pill-link">
              Audit Log
            </a>
            <a href="/evals" className="nav-pill-link">
              Eval Dashboard
            </a>
            <label htmlFor="mode-select" className="mode-label">
              Mode:
            </label>
            <select
              id="mode-select"
              value={mode}
              onChange={(e) => setMode(e.target.value as "graphrag" | "baseline")}
              className="mode-select"
              disabled={loading}
            >
              <option value="graphrag">GraphRAG (hybrid + graph)</option>
              <option value="baseline">Baseline (hybrid text only)</option>
            </select>
          </div>
        </header>

        <section className="sample-bar" aria-label="Example questions">
          <span className="sample-label">Try:</span>
          {SAMPLE_QUESTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="sample-btn"
              disabled={loading}
              onClick={() => void sendQuestion(s.question)}
            >
              <strong>{s.id}</strong>: {s.question}
            </button>
          ))}
        </section>

        <section className="chat-log" aria-live="polite" aria-label="Conversation">
          {messages.length === 0 && !loading && (
            <div className="empty-state">
              <p>
                Ask an access-governance question about Kestrel Financial Group policies, systems,
                data classifications, controls or required approvals.
              </p>
              <p className="empty-hint">
                Every claim is backed by a cited policy clause or graph relationship. Write actions
                require explicit human confirmation.
              </p>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === "user") {
              return (
                <article key={m.id} className="msg msg-user">
                  <div className="msg-role">You</div>
                  <div className="msg-body">{m.text}</div>
                </article>
              );
            }

            const turnDraft = m.turn?.draft
              ? (draftsById[m.turn.draft.draft_id] ?? m.turn.draft)
              : null;
            const timeline = turnDraft ? timelinesByDraftId[turnDraft.draft_id] : undefined;

            return (
              <article
                key={m.id}
                className={`msg msg-assistant ${selectedTurn === m.turn ? "msg-selected" : ""}`}
                onClick={() => m.turn && setSelectedTurn(m.turn)}
              >
                <div className="msg-header">
                  <span className="msg-role">Copilot</span>
                  {m.turn && (
                    <div className="msg-badges">
                      <span className="badge badge-route">
                        Route: {routeDisplayLabel(m.turn.route, m.turn.mode)}
                      </span>
                      <span className={`badge badge-confidence-${m.turn.answer.confidence}`}>
                        Confidence: {m.turn.answer.confidence.toUpperCase()}
                      </span>
                      <span className="badge badge-simulated">SIMULATED</span>
                    </div>
                  )}
                </div>

                {m.error ? (
                  <div className="msg-error" role="alert">
                    {m.error}
                  </div>
                ) : m.turn ? (
                  <div className="msg-content">
                    {m.turn.answer.clarifying_question && (
                      <p className="clarifying-question">{m.turn.answer.clarifying_question}</p>
                    )}

                    {m.turn.answer.claims.length > 0 ? (
                      <ul className="claims-list">
                        {m.turn.answer.claims.map((claim, idx) => (
                          <li key={idx} className="claim-item">
                            <span className="claim-text">{claim.text}</span>
                            {claim.source_status === "proposal_or_meeting" && (
                              <span className="proposal-flag">
                                (proposal / meeting note, not policy in force)
                              </span>
                            )}
                            {claim.citations.length > 0 && (
                              <span className="claim-citations">
                                {claim.citations.map((cit, cIdx) => {
                                  const chip = formatCitationChip(cit);
                                  return (
                                    <a
                                      key={cIdx}
                                      href={chip.anchor}
                                      className="citation-chip"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (m.turn) setSelectedTurn(m.turn);
                                      }}
                                    >
                                      {chip.label}
                                    </a>
                                  );
                                })}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="msg-markdown">{m.turn.answer.markdown}</p>
                    )}

                    {m.turn.answer.legitimate_path && (
                      <p className="legitimate-path">
                        <strong>Legitimate path:</strong> {m.turn.answer.legitimate_path}
                      </p>
                    )}

                    {turnDraft && (
                      <div
                        className="msg-draft-container"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DraftCard
                          draft={turnDraft}
                          busy={Boolean(draftBusyById[turnDraft.draft_id])}
                          error={draftErrorById[turnDraft.draft_id] ?? null}
                          onConfirm={() => handleConfirmDraft(turnDraft)}
                          onCancel={() => handleCancelDraft(turnDraft)}
                        />
                        {timeline && (
                          <Timeline
                            timeline={timeline}
                            onRefresh={() =>
                              refreshTimeline(turnDraft.draft_id, timeline.request_id)
                            }
                          />
                        )}
                      </div>
                    )}

                    <div className="inline-meta">
                      <span>
                        <strong>Assumptions:</strong>{" "}
                        {m.turn.answer.assumptions.length > 0
                          ? m.turn.answer.assumptions.join(" · ")
                          : "none"}
                      </span>
                      <span>
                        <strong>Gaps:</strong>{" "}
                        {m.turn.answer.gaps.length > 0 ? m.turn.answer.gaps.join(" · ") : "none"}
                      </span>
                      <span className="inline-cost">
                        Cost ${m.turn.cost_usd.toFixed(4)} · {(m.turn.latency_ms / 1000).toFixed(2)}
                        s
                      </span>
                    </div>

                    {m.turn.mode === "graphrag" && m.question && (
                      <div style={{ marginTop: "0.5rem" }}>
                        <CompareToggle
                          question={m.question}
                          primaryTurn={m.turn}
                          conversationId={convId}
                          onSelectTurn={(t) => setSelectedTurn(t)}
                        />
                      </div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}

          {loading && (
            <div className="msg msg-assistant msg-loading" role="status">
              Routing question, retrieving evidence and verifying citations…
            </div>
          )}
        </section>

        <form className="chat-form" onSubmit={handleSubmit}>
          <label htmlFor="chat-input" className="sr-only">
            Ask about access, policies, systems
          </label>
          <input
            id="chat-input"
            type="text"
            className="chat-input"
            placeholder="Ask about access, policies, systems…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className="chat-submit" disabled={loading || !input.trim()}>
            {loading ? "Thinking…" : "Ask ⏎"}
          </button>
        </form>
      </main>

      <EvidencePanel turn={selectedTurn} />
    </div>
  );
}
