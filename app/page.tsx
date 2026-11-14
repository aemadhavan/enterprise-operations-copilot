"use client";

import React, { useId, useState } from "react";
import {
  EvidencePanel,
  formatCitationChip,
  routeDisplayLabel,
  type ChatTurnResponse,
} from "./components/EvidencePanel";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
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
];

export default function Home() {
  const convId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"graphrag" | "baseline">("graphrag");
  const [loading, setLoading] = useState(false);
  const [selectedTurn, setSelectedTurn] = useState<ChatTurnResponse | null>(null);

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
      setSelectedTurn(turn);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: turn.answer.markdown,
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
          <div className="mode-controls" role="group" aria-label="Retrieval mode">
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

          {messages.map((m) =>
            m.role === "user" ? (
              <article key={m.id} className="msg msg-user">
                <div className="msg-role">You</div>
                <div className="msg-body">{m.text}</div>
              </article>
            ) : (
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
                  </div>
                ) : null}
              </article>
            ),
          )}

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
