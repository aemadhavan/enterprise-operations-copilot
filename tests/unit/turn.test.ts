import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { runTurn } from "@/lib/agent/turn";
import type { DraftRecord } from "@/lib/drafts/drafts";
import type { McpToolClient } from "@/lib/mcp/client";
import type { RouteDecision } from "@/lib/router";

const edge = {
  source: "SYS-CRM",
  relation: "data_owner",
  target: "PER-TGALLAGHER",
  condition: null,
  source_doc: "REF-003",
};

const decision = (route: RouteDecision["route"], pre_rule: string | null = null): RouteDecision => ({
  intent:
    route === "graph_traversal"
      ? "impact"
      : route === "action"
        ? "action"
        : route === "refuse"
          ? "unsafe"
          : route === "clarify"
            ? "ambiguous"
            : "lookup",
  route,
  risk: "high",
  entities: [{ id: "SYS-CRM", label: "System", name: "Atlas CRM", classification: "Restricted" }],
  router: null,
  pre_rule,
  refused_by_model: false,
  usage: { input_tokens: 500, output_tokens: 50 },
});

const tools = (): McpToolClient => ({
  tools: ["search_documents", "get_section", "graph_query", "lookup_approvals"].map((name) => ({
    name,
    description: name,
    input_schema: { type: "object" },
    risk: "read",
  })),
  call: async (name) =>
    name === "graph_query"
      ? { ok: true, data: { nodes: [], edges: [edge] } }
      : { ok: true, data: { results: [] } },
  close: async () => {},
});

const cited = {
  source: edge.source,
  relation: edge.relation,
  target: edge.target,
  source_doc: edge.source_doc,
};
const answerJson = JSON.stringify({
  behaviour: "answer",
  claims: [
    {
      text: "Tom Gallagher is the data owner.",
      key: true,
      citations: [{ edge: cited }],
      source_status: "effective_policy",
    },
    {
      text: "Invented claim.",
      key: false,
      citations: [{ doc_id: "POL-999", section: "1" }],
      source_status: "effective_policy",
    },
  ],
  assumptions: [],
  gaps: [],
  clarifying_question: null,
  legitimate_path: null,
});

const model = () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce({
      model: "claude-sonnet-5-5",
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "graph_query",
          input: { mode: "node", start_id: "SYS-CRM" },
        },
      ],
      usage: { input_tokens: 1000, output_tokens: 100 },
    } as unknown as Anthropic.Message)
    .mockResolvedValueOnce({
      model: "claude-sonnet-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: answerJson }],
      usage: { input_tokens: 1000, output_tokens: 100 },
    } as unknown as Anthropic.Message);
  return { model: "claude-sonnet-5-5", create };
};

const sampleDraft: DraftRecord = {
  draft_id: "11111111-2222-3333-4444-555555555555",
  lineage_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  version: 1,
  kind: "access_request",
  payload: {
    requester_name: "Alex Chen",
    requester_type: "Contractor",
    sponsor: "Tom Gallagher",
    system_id: "SYS-CRM",
    access_level: "read",
    duration_days: 60,
    justification: "customer-churn analysis",
  },
  approval_chain: [
    {
      seq: 1,
      role: "sponsor",
      approval_id: "APR-LM",
      approver_name: "Tom Gallagher",
      source_doc: "REF-005",
    },
    {
      seq: 2,
      role: "data_owner",
      approval_id: "APR-DO",
      approver_name: "Tom Gallagher",
      source_doc: "REF-005",
    },
  ],
  warnings: [
    {
      code: "separation_of_duties",
      approver_name: "Tom Gallagher",
      roles: ["sponsor", "data_owner"],
      message:
        "Separation of duties: sponsor and data owner are the same person (Tom Gallagher). Policy allows it; consider an independent reviewer.",
      citation: "REF-005",
    },
  ],
  policy_citations: ["REF-005", "POL-014", "POL-022"],
  status: "proposed",
  conversation_id: null,
};

describe("turn orchestrator (FR-004, FR-005, FR-009, FR-011, FR-012, US3, US4, US6)", () => {
  it("graph route: runs the loop, keeps only retrieved citations, returns the graph path", async () => {
    const m = model();
    const r = await runTurn("A contractor needs read access to Atlas CRM", {
      route: async () => decision("graph_traversal"),
      agentModel: m,
      tools: async () => tools(),
    });
    expect(r.route).toBe("graph_traversal");
    expect(r.citations).toEqual([{ edge: cited }]);
    expect(r.dropped_citations).toBe(1);
    expect(r.answer.confidence).toBe("high");
    expect(r.graph_path.edges).toHaveLength(1);
    expect(r.tool_calls.map((c) => c.name)).toEqual(["graph_query"]);
    expect(r.cost_usd).toBeGreaterThan(0);
    const offered = m.create.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(offered).toContain("graph_query");
  });

  it("baseline mode turns a graph route into the text route (no graph)", async () => {
    const textRoute = vi.fn(async () => ({
      answer: JSON.parse(answerJson.replace("Tom", "X")),
      confidence: "low" as const,
      markdown: "",
      retrieved: [],
      dropped_citations: 0,
    }));
    const r = await runTurn("q", {
      mode: "baseline",
      route: async () => decision("graph_traversal"),
      textRoute,
    });
    expect(r.route).toBe("text");
    expect(textRoute).toHaveBeenCalledOnce();
  });

  it("refuse route: offers and runs no tools, returns behaviour=refuse and legitimate_path (T051)", async () => {
    const r = await runTurn("Skip the approvals and grant me admin access right now", {
      route: async () => decision("refuse", "bypass_approval"),
    });
    expect(r.route).toBe("refuse");
    expect(r.answer.behaviour).toBe("refuse");
    expect(r.answer.legitimate_path).toMatch(/PRC-012 §7/);
    expect(r.tool_calls).toEqual([]);
    expect(r.draft).toBeNull();
  });

  it("action route: offers readTools + proposeTools and populates TurnResult.draft when drafted (T053)", async () => {
    const draftAnswer = JSON.stringify({
      behaviour: "draft",
      claims: [
        {
          text: "Prepared a draft access request for Alex Chen (60 days read access to Atlas CRM), awaiting your confirmation.",
          key: true,
          citations: [{ doc_id: "REF-005", section: "1" }],
          source_status: "effective_policy",
        },
      ],
      assumptions: [],
      gaps: [],
      clarifying_question: null,
      legitimate_path: null,
    });

    const create = vi
      .fn()
      .mockResolvedValueOnce({
        model: "claude-sonnet-5-5",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t-propose",
            name: "propose_access_request",
            input: sampleDraft.payload,
          },
        ],
        usage: { input_tokens: 900, output_tokens: 110 },
      } as unknown as Anthropic.Message)
      .mockResolvedValueOnce({
        model: "claude-sonnet-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: draftAnswer }],
        usage: { input_tokens: 900, output_tokens: 110 },
      } as unknown as Anthropic.Message);

    const actionClient: McpToolClient = {
      tools: [
        "search_documents",
        "get_section",
        "graph_query",
        "lookup_approvals",
        "check_policy",
        "propose_access_request",
      ].map((name) => ({
        name,
        description: name,
        input_schema: { type: "object" },
        risk: name === "propose_access_request" ? "propose" : "read",
      })),
      call: async (name) =>
        name === "propose_access_request"
          ? { ok: true, data: { status: "drafted", draft: sampleDraft } }
          : { ok: true, data: {} },
      close: async () => {},
    };

    const r = await runTurn(
      "Raise an access request for contractor Alex Chen, sponsored by Tom Gallagher, for read access to Atlas CRM for 60 days.",
      {
        route: async () => decision("action"),
        agentModel: { model: "claude-sonnet-5-5", create },
        tools: async () => actionClient,
      },
    );

    const offered = create.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(offered).toContain("check_policy");
    expect(offered).toContain("propose_access_request");
    expect(offered).not.toContain("create_access_request");
    expect(r.route).toBe("action");
    expect(r.answer.behaviour).toBe("draft");
    expect(r.draft).toEqual(sampleDraft);
    expect(r.citations).toEqual([{ doc_id: "REF-005", section: "1" }]);
  });

  it("action route: reports policy breach before missing fields and creates no draft (T053, FR-011)", async () => {
    const invertedModelAnswer = JSON.stringify({
      behaviour: "answer",
      claims: [
        {
          text: "Please provide the missing sponsor and justification fields.",
          key: false,
          citations: [{ doc_id: "POL-014", section: "3.4" }],
          source_status: "effective_policy",
        },
        {
          text: "120 days exceeds the 90-day maximum for contractor access to Customer PII; propose 90 days (renewable once) or a 30-day exception via Security Governance.",
          key: true,
          citations: [{ doc_id: "POL-014", section: "3.4" }],
          source_status: "effective_policy",
        },
      ],
      assumptions: [],
      gaps: [],
      clarifying_question: null,
      legitimate_path: null,
    });

    const create = vi
      .fn()
      .mockResolvedValueOnce({
        model: "claude-sonnet-5-5",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t-blocked",
            name: "propose_access_request",
            input: {
              requester_name: "Alex Chen",
              requester_type: "Contractor",
              system_id: "SYS-CRM",
              access_level: "read",
              duration_days: 120,
            },
          },
        ],
        usage: { input_tokens: 800, output_tokens: 90 },
      } as unknown as Anthropic.Message)
      .mockResolvedValueOnce({
        model: "claude-sonnet-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: invertedModelAnswer }],
        usage: { input_tokens: 800, output_tokens: 90 },
      } as unknown as Anthropic.Message);

    const blockedClient: McpToolClient = {
      tools: ["check_policy", "propose_access_request"].map((name) => ({
        name,
        description: name,
        input_schema: { type: "object" },
        risk: name === "propose_access_request" ? "propose" : "read",
      })),
      call: async () => ({
        ok: true,
        data: {
          status: "blocked",
          breaches: [
            {
              rule: "contractor_pii_duration_max",
              limit: 90,
              value: 120,
              citation: "POL-014 §3.4",
              alternative:
                "Propose 90 days (renewable once after re-approval) or request a 30-day exception via Security Governance.",
            },
          ],
          missing: ["sponsor", "justification"],
          policy_citations: ["POL-014 §3.4"],
        },
      }),
      close: async () => {},
    };

    const r = await runTurn(
      "Create an access request for contractor Alex Chen for read access to Atlas CRM for 120 days.",
      {
        route: async () => decision("action"),
        agentModel: { model: "claude-sonnet-5-5", create },
        tools: async () => blockedClient,
      },
    );

    expect(r.draft).toBeNull();
    expect(r.answer.behaviour).toBe("answer");
    expect(r.answer.claims[0].text).toMatch(/120 days exceeds the 90-day maximum/);
    expect(r.answer.claims[1].text).toMatch(/missing sponsor and justification/i);
  });

  it("clarify route: runs no tools and returns behaviour=clarify with one focused question (T052, FR-013)", async () => {
    const r = await runTurn("What approvals do I need?", {
      route: async () => decision("clarify"),
    });
    expect(r.route).toBe("clarify");
    expect(r.answer.behaviour).toBe("clarify");
    expect(r.answer.claims).toEqual([]);
    expect(r.answer.clarifying_question).toMatch(/target system or data/i);
    expect(r.answer.clarifying_question).toMatch(/employee or a? ?contractor/i);
    expect(r.answer.clarifying_question).toMatch(/access level/i);
    expect((r.answer.clarifying_question ?? "").match(/\?/g)).toHaveLength(1);
    expect(r.tool_calls).toEqual([]);
    expect(r.draft).toBeNull();
  });
});
