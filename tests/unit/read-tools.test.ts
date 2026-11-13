import { describe, expect, it } from "vitest";
import { createAgentClient } from "@/lib/mcp/client";
import { createMcpServer } from "@/lib/mcp/server";
import { readTools, toGraphQueryInput, type ReadToolDeps } from "@/lib/mcp/tools/read";

const fakeDeps = (): ReadToolDeps & { graphCalls: unknown[] } => {
  const graphCalls: unknown[] = [];
  return {
    graphCalls,
    search: async () => [
      {
        chunk_id: "1",
        doc_id: "POL-014",
        section: "3. Requirements > 3.4",
        text: "90 days",
        score: 0.0321,
        fts_rank: 1,
        vector_rank: 1,
        title: "Data Handling",
        doc_type: "policy",
        version: "1",
        owner: null,
        effective_date: "2026-01-01",
        is_authoritative: true,
      },
    ],
    section: async () => null,
    graph: async (input) => {
      graphCalls.push(input);
      return { nodes: [], edges: [] };
    },
    snapshot: async () => ({ nodes: [], edges: [] }),
  };
};

describe("read tools (contracts/mcp-tools.md, FR-014)", () => {
  it("registers the four read tools, all risk read, with strict object schemas", async () => {
    const c = await createAgentClient(createMcpServer(readTools(fakeDeps())));
    expect(c.tools.map((t) => t.name)).toEqual([
      "search_documents",
      "get_section",
      "graph_query",
      "lookup_approvals",
    ]);
    for (const t of c.tools) {
      expect(t.risk).toBe("read");
      expect(t.input_schema).toMatchObject({ type: "object", additionalProperties: false });
    }
    await c.close();
  });

  it("search_documents returns citable doc_id + section and the source status", async () => {
    const c = await createAgentClient(createMcpServer(readTools(fakeDeps())));
    const r = await c.call("search_documents", { query: "contractor PII duration" });
    expect(r.data).toMatchObject({
      results: [
        { doc_id: "POL-014", section: "3. Requirements > 3.4", status: "effective_policy" },
      ],
    });
    await c.close();
  });

  it("graph_query maps the flat tool input onto the three seed modes", async () => {
    expect(toGraphQueryInput({ mode: "node", start_id: "SYS-CRM", max_hops: "3" })).toEqual({
      mode: "node",
      start_id: "SYS-CRM",
      max_hops: 3,
    });
    expect(
      toGraphQueryInput({ mode: "label", label: "System", classification: "Restricted" }),
    ).toEqual({ mode: "label", label: "System", classification: "Restricted" });
    expect(toGraphQueryInput({ mode: "relation", relation: "led_to" })).toEqual({
      mode: "relation",
      relation: "led_to",
    });
    const deps = fakeDeps();
    const c = await createAgentClient(createMcpServer(readTools(deps)));
    expect((await c.call("graph_query", { mode: "node" })).ok).toBe(false); // start_id required
    expect(deps.graphCalls).toEqual([]);
    await c.close();
  });
});
