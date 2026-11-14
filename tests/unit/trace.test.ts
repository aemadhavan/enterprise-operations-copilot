import { beforeEach, describe, expect, it } from "vitest";
import { runTurn } from "@/lib/agent/turn";
import {
  type ApprovalDecisionTrace,
  getRecordedTrace,
  type LangfuseClientLike,
  recordApprovalDecision,
  recordTurnTrace,
  resetTraceStore,
  setLangfuseClient,
  type TurnTracePayload,
} from "@/lib/observability/langfuse";

function createFakeLangfuseClient() {
  const traces: TurnTracePayload[] = [];
  const events: ApprovalDecisionTrace[] = [];
  const client: LangfuseClientLike = {
    trace(payload) {
      traces.push(structuredClone(payload));
    },
    event(decision) {
      events.push(structuredClone(decision));
    },
  };
  return { client, traces, events };
}

describe("Langfuse tracing (T059, FR-016, FR-017, Constitution IV)", () => {
  beforeEach(() => {
    resetTraceStore();
    setLangfuseClient(null);
  });

  it("records every required field and redacts PII before sending to Langfuse", async () => {
    const fake = createFakeLangfuseClient();

    const trace = await recordTurnTrace({
      question: "Please grant access for jane.doe@example.com (EMP-998877, +61 412 345 678)",
      mode: "graphrag",
      intent: "action_request for jane.doe@example.com",
      risk: "propose",
      route: "action",
      retrievals: [
        {
          doc_id: "POL-014",
          section: "4.2",
          is_authoritative: true,
        },
      ],
      graph_edges: [
        {
          source: "System:analytics-prod",
          relation: "REQUIRES_APPROVAL_FROM",
          target: "Role:data_owner",
          condition: "duration_days <= 90",
          source_doc: "POL-014 §4.2",
        },
      ],
      tool_calls: [
        {
          name: "propose_access_request",
          input: {
            requester_email: "jane.doe@example.com",
            employee_id: "EMP-998877",
            phone: "0412 345 678",
            card: "4111 2222 3333 4444",
            system: "analytics-prod",
            policy_ref: "POL-014",
          },
          ok: true,
          ms: 42,
        },
      ],
      draft_ids: ["drf-test-001"],
      behaviour: "draft",
      confidence: "high",
      citations: [{ doc_id: "POL-014", section: "4.2" }],
      usage: { input_tokens: 1200, output_tokens: 350 },
      model_for_pricing: "claude-sonnet-5-5",
      latency_ms: 480,
      client: fake.client,
    });

    expect(fake.traces).toHaveLength(1);
    const sent = fake.traces[0];
    expect(sent.trace_id).toBe(trace.trace_id);
    expect(sent.mode).toBe("graphrag");
    expect(sent.route).toBe("action");
    expect(sent.risk).toBe("propose");
    expect(sent.behaviour).toBe("draft");
    expect(sent.confidence).toBe("high");
    expect(sent.retrievals).toEqual([
      { doc_id: "POL-014", section: "4.2", is_authoritative: true },
    ]);
    expect(sent.graph_edges).toEqual([
      {
        source: "System:analytics-prod",
        relation: "REQUIRES_APPROVAL_FROM",
        target: "Role:data_owner",
        condition: "duration_days <= 90",
        source_doc: "POL-014 §4.2",
      },
    ]);
    expect(sent.draft_ids).toEqual(["drf-test-001"]);
    expect(sent.approval_decisions).toEqual([]);
    expect(sent.tokens).toEqual({
      input_tokens: 1200,
      output_tokens: 350,
      total_tokens: 1550,
    });
    expect(sent.cost_usd).toBeGreaterThan(0);
    expect(sent.latency_ms).toBe(480);

    // Redaction checks on question, intent, and tool call arguments
    expect(sent.question).toContain("[REDACTED:email]");
    expect(sent.question).toContain("[REDACTED:id]");
    expect(sent.question).toContain("[REDACTED:phone]");
    expect(sent.question).not.toContain("jane.doe@example.com");
    expect(sent.question).not.toContain("EMP-998877");

    expect(sent.intent).toContain("[REDACTED:email]");
    const toolInput = sent.tool_calls[0].input as Record<string, string>;
    expect(toolInput.requester_email).toBe("[REDACTED:email]");
    expect(toolInput.employee_id).toBe("[REDACTED:id]");
    expect(toolInput.phone).toBe("[REDACTED:phone]");
    expect(toolInput.card).toBe("[REDACTED:card]");
    expect(toolInput.policy_ref).toBe("POL-014"); // System ID preserved
  });

  it("records approval decisions (confirmations, cancellations, approver steps, sla_breached) linked to trace_id", async () => {
    const fake = createFakeLangfuseClient();
    setLangfuseClient(fake.client);

    const turnTrace = await recordTurnTrace({
      question: "Request read access to warehouse",
      mode: "graphrag",
      intent: "access_request",
      risk: "propose",
      route: "action",
      retrievals: [{ doc_id: "POL-001", section: "2.1", is_authoritative: true }],
      graph_edges: [],
      tool_calls: [],
      draft_ids: ["drf-101", "drf-102"],
      behaviour: "draft",
      confidence: "high",
      citations: [{ doc_id: "POL-001", section: "2.1" }],
      usage: { input_tokens: 500, output_tokens: 150 },
      latency_ms: 210,
    });

    const confirmDecision = await recordApprovalDecision({
      type: "confirmation",
      draft_id: "drf-101",
      request_id: "AR-0001",
      actor: "alice@example.com",
      decision: "confirmed",
      sla_breached: false,
    });
    expect(confirmDecision.trace_id).toBe(turnTrace.trace_id);
    expect(confirmDecision.actor).toBe("[REDACTED:email]");
    expect(confirmDecision.sla_breached).toBe(false);

    const stepDecision = await recordApprovalDecision({
      type: "approver_step",
      request_id: "AR-0001",
      role: "security_approver",
      actor: "sec.lead@example.com",
      decision: "approve",
      sla_breached: true,
    });
    expect(stepDecision.trace_id).toBe(turnTrace.trace_id);
    expect(stepDecision.actor).toBe("[REDACTED:email]");
    expect(stepDecision.sla_breached).toBe(true);

    const cancelDecision = await recordApprovalDecision({
      type: "cancellation",
      draft_id: "drf-102",
      actor: "bob@example.com",
      decision: "cancelled",
      sla_breached: false,
    });
    expect(cancelDecision.trace_id).toBe(turnTrace.trace_id);
    expect(cancelDecision.decision).toBe("cancelled");

    const updated = getRecordedTrace(turnTrace.trace_id);
    expect(updated?.approval_decisions).toHaveLength(3);
    expect(updated?.approval_decisions.map((d) => d.type)).toEqual([
      "confirmation",
      "approver_step",
      "cancellation",
    ]);
    expect(updated?.approval_decisions[1]?.sla_breached).toBe(true);
    expect(fake.events).toHaveLength(3);
  });

  it("wires trace_id through runTurn using injected fake Langfuse client", async () => {
    const fake = createFakeLangfuseClient();

    const result = await runTurn("What is the retention policy for logs? Contact user@corp.io", {
      langfuse: fake.client,
      route: async () => ({
        route: "text",
        intent: "lookup",
        risk: "low" as never,
        entities: [],
        pre_rule: null,
        router: null,
        refused_by_model: false,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
      textRoute: async () => ({
        answer: {
          behaviour: "answer",
          claims: [
            {
              text: "Audit logs are retained for 7 years.",
              key: true,
              citations: [{ doc_id: "POL-014", section: "3.1" }],
              source_status: "effective_policy",
            },
          ],
          assumptions: [],
          gaps: [],
          clarifying_question: null,
          legitimate_path: null,
        },
        confidence: "high",
        markdown: "Audit logs are retained for 7 years. [POL-014 §3.1]",
        retrieved: [
          {
            chunk_id: "chk-1",
            doc_id: "POL-014",
            section: "3.1",
            title: "Logging Policy",
            heading: "Retention",
            content: "Audit logs are retained for 7 years.",
            status: "effective_policy",
            effective_date: "2026-01-01",
            review_Status: "approved",
            is_authoritative: true,
            rrf_score: 0.95,
            fts_rank: 1,
            vec_rank: 1,
          } as never,
        ],
        dropped_citations: 0,
        usage: { input_tokens: 400, output_tokens: 80 },
      }),
    });

    expect(result.trace_id).toBeTruthy();
    expect(fake.traces).toHaveLength(1);
    expect(fake.traces[0].trace_id).toBe(result.trace_id);
    expect(fake.traces[0].question).toContain("[REDACTED:email]");
    expect(fake.traces[0].route).toBe("text");
    expect(fake.traces[0].intent).toBe("lookup");
    expect(fake.traces[0].risk).toBe("low");
    expect(fake.traces[0].tokens).toEqual({
      input_tokens: 500,
      output_tokens: 100,
      total_tokens: 600,
    });
    expect(fake.traces[0].cost_usd).toBe(result.cost_usd);
  });
});
