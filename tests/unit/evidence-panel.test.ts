import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EvidencePanel,
  extractSourceItems,
  formatCitationChip,
  routeDisplayLabel,
  type ChatTurnResponse,
} from "@/app/components/EvidencePanel";

const sampleTurn: ChatTurnResponse = {
  route: "graph_traversal",
  intent: "impact",
  risk: "high",
  mode: "graphrag",
  answer: {
    markdown: "- Atlas CRM stores Customer PII `SYS-CRM -stores-> DC-PII (REF-003)`",
    claims: [
      {
        text: "Atlas CRM stores Customer PII (Restricted).",
        key: true,
        citations: [
          {
            edge: {
              source: "SYS-CRM",
              relation: "stores",
              target: "DC-PII",
              source_doc: "REF-003",
            },
          },
          { doc_id: "POL-014", section: "3. Requirements > 3.4" },
        ],
        source_status: "effective_policy",
      },
    ],
    assumptions: ["Read access only", "Not vendor staff"],
    gaps: [],
    confidence: "high",
    behaviour: "answer",
    legitimate_path: null,
    clarifying_question: null,
  },
  citations: [
    {
      edge: {
        source: "SYS-CRM",
        relation: "stores",
        target: "DC-PII",
        source_doc: "REF-003",
      },
    },
    { doc_id: "POL-014", section: "3. Requirements > 3.4" },
  ],
  graph_path: {
    nodes: [
      { id: "SYS-CRM", label: "System", name: "Atlas CRM", classification: "Restricted" },
      { id: "DC-PII", label: "DataClass", name: "Customer PII", classification: "Restricted" },
    ],
    edges: [
      {
        source: "SYS-CRM",
        relation: "stores",
        target: "DC-PII",
        condition: null,
        source_doc: "REF-003",
      },
    ],
  },
  tool_calls: [{ name: "graph_query", input: { mode: "node" }, ok: true, ms: 42 }],
  draft: null,
  trace_id: "tr-1234567890",
  latency_ms: 3820,
  cost_usd: 0.0124,
};

describe("EvidencePanel and citation helpers (T034, US1, US2)", () => {
  it("formats doc and edge citation chips with real anchor links", () => {
    const docChip = formatCitationChip({ doc_id: "POL-014", section: "3. Requirements > 3.4" });
    expect(docChip).toEqual({
      label: "POL-014 §3.4",
      docId: "POL-014",
      anchor: "#source-POL-014",
      isEdge: false,
    });

    const edgeChip = formatCitationChip({
      edge: { source: "SYS-CRM", relation: "stores", target: "DC-PII", source_doc: "REF-003" },
    });
    expect(edgeChip.label).toBe("SYS-CRM ─stores→ DC-PII (REF-003)");
    expect(edgeChip.anchor).toBe("#source-REF-003");
    expect(edgeChip.isEdge).toBe(true);
  });

  it("extracts deduplicated source items from citations and graph edges", () => {
    const items = extractSourceItems(sampleTurn.citations, sampleTurn.graph_path.edges);
    expect(items.map((i) => i.docId)).toEqual(["REF-003", "POL-014"]);
  });

  it("formats route display labels for graphrag and baseline modes", () => {
    expect(routeDisplayLabel("graph_traversal", "graphrag")).toContain("GraphRAG");
    expect(routeDisplayLabel("text", "baseline")).toBe("text (baseline)");
  });

  it("renders route, confidence, graph path, sources, assumptions, gaps, trace link and SIMULATED badge", () => {
    const html = renderToStaticMarkup(React.createElement(EvidencePanel, { turn: sampleTurn }));
    expect(html).toContain("SIMULATED");
    expect(html).toContain("graph_traversal");
    expect(html).toContain("HIGH");
    expect(html).toContain("Atlas CRM (Restricted)");
    expect(html).toContain("─stores→");
    expect(html).toContain("Customer PII (Restricted)");
    expect(html).toContain("REF-003");
    expect(html).toContain("POL-014");
    expect(html).toContain("Read access only");
    expect(html).toContain("none"); // gaps
    expect(html).toContain("Trace ▸");
    expect(html).toContain("$0.0124");
    expect(html).toContain("3.82s");
  });
});

