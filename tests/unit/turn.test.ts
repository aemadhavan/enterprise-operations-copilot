import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { RouteDecision } from "@/lib/router";
import { runTurn } from "@/lib/agent/turn";
import type { McpToolClient } from "@/lib/mcp/client";

const edge = {
  source: "SYS-CRM",
  relation: "data_owner",
  target: "PER-TGALLAGHER",
  condition: null,
  source_doc: "REF-003",
};

const decision = (route: RouteDecision["route"]): RouteDecision => ({
  intent: route === "graph_traversal" ? "impact" : "lookup",
  route,
  risk: "high",
  entities: [{ id: "SYS-CRM", label: "System", name: "Atlas CRM", classification: null }],
  router: null,
  pre_rule: null,
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

describe("turn orchestrator (FR-004, FR-005, US6)", () => {
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

  it("routes not built yet run no tools and say so", async () => {
    const r = await runTurn("skip the approvals", { route: async () => decision("refuse") });
    expect(r.answer.behaviour).toBe("state_gap");
    expect(r.answer.gaps[0]).toMatch(/T051/);
    expect(r.tool_calls).toEqual([]);
  });
});
