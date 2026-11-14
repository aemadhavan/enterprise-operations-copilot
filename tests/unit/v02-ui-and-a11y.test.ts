import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompareToggle } from "@/app/components/CompareToggle";
import type { ChatTurnResponse } from "@/app/components/EvidencePanel";
import EvalsDashboardPage, { parseMarkdownTables } from "@/app/evals/page";

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const n = Number.parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(hexToRgb(fgHex));
  const l2 = relativeLuminance(hexToRgb(bgHex));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const sampleGraphTurn: ChatTurnResponse = {
  route: "graph_traversal",
  intent: "impact",
  risk: "high",
  mode: "graphrag",
  answer: {
    markdown: "Contractor read access to Atlas CRM requires 4 approvals.",
    claims: [
      {
        text: "Contractor read access to Atlas CRM requires sponsor, data owner (Mei Lin Tan), Security Governance (Priya Nair) and Privacy Officer (Elena Novak) approval.",
        key: true,
        citations: [{ doc_id: "REF-005", section: "Approval Matrix" }],
        source_status: "effective_policy",
      },
    ],
    assumptions: [],
    gaps: [],
    confidence: "high",
    behaviour: "answer",
    legitimate_path: null,
    clarifying_question: null,
  },
  citations: [{ doc_id: "REF-005", section: "Approval Matrix" }],
  graph_path: {
    nodes: [{ id: "SYS-CRM", label: "System", name: "Atlas CRM", classification: "Restricted" }],
    edges: [
      {
        source: "SYS-CRM",
        relation: "stores",
        target: "DATA-PII",
        condition: null,
        source_doc: "REF-003",
      },
    ],
  },
  tool_calls: [],
  draft: null,
  latency_ms: 3200,
  cost_usd: 0.0084,
  usage: { input_tokens: 1800, output_tokens: 240 },
  trace_id: "trace-a11y-1",
};

const sampleBaselineTurn: ChatTurnResponse = {
  ...sampleGraphTurn,
  route: "text",
  mode: "baseline",
  graph_path: { nodes: [], edges: [] },
};

describe("v0.2 UI components & WCAG 2.2 AA accessibility checks (T067, T070, T073)", () => {
  it("meets WCAG 2.2 AA 4.5:1 contrast ratio on all theme foreground/background token pairs", () => {
    const pairs: [string, string, string][] = [
      ["body text on surface", "#0f172a", "#ffffff"],
      ["body text on app bg", "#0f172a", "#f8fafc"],
      ["muted text on surface", "#475569", "#ffffff"],
      ["muted text on muted surface", "#475569", "#f1f5f9"],
      ["primary button text on primary", "#ffffff", "#1d4ed8"],
      ["citation chip text on chip bg", "#1e3a8a", "#e0e7ff"],
      ["simulated badge text on sim bg", "#92400e", "#fef3c7"],
      ["high confidence badge text on bg", "#14532d", "#dcfce7"],
      ["medium confidence badge text on bg", "#713f12", "#fef9c3"],
      ["low confidence badge text on bg", "#7f1d1d", "#fee2e2"],
    ];

    for (const [label, fg, bg] of pairs) {
      const ratio = contrastRatio(fg, bg);
      expect(ratio, `${label} (${fg} on ${bg})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("includes :focus-visible keyboard focus styles and real citation anchor links", () => {
    const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain(":focus-visible");

    const html = renderToStaticMarkup(
      React.createElement(CompareToggle, {
        question: "What approvals are needed for Atlas CRM?",
        primaryTurn: sampleGraphTurn,
        baselineTurn: sampleBaselineTurn,
      }),
    );
    expect(html).toContain("GraphRAG (Hybrid + Graph)");
    expect(html).toContain("Baseline (Hybrid Text Only)");
    expect(html).toContain('href="#source-REF-005"');
  });

  it("parses evaluation summary markdown and renders the /evals dashboard page (T070)", () => {
    const sampleMd = [
      "# Evaluation Summary",
      "",
      "- **Tier**: 2 (milestone M5)",
      "- **Modes**: baseline, graphrag",
      "",
      "## Results",
      "",
      "| SC | Metric | Mode | Value | Threshold | Cases | Gate |",
      "|---|---|---|---|---|---|---|",
      "| SC-010 | recall_at_5 | graphrag | 100.0% | 90% | 26 | PASS |",
      "",
      "## Metric × Mode × Category",
      "",
      "| Category | Mode | Cases | Recall@5 |",
      "|---|---|---|---|",
      "| multi_hop | graphrag | 8 | 100.0% |",
    ].join("\n");

    const parsed = parseMarkdownTables(sampleMd);
    expect(parsed.metaBullets.length).toBe(2);
    expect(parsed.tables.length).toBe(2);

    const html = renderToStaticMarkup(React.createElement(EvalsDashboardPage));
    expect(html).toContain("Evaluation Dashboard");
    expect(html).toContain("Latest Run Metadata");
  });
});
