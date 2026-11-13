import { describe, expect, it } from "vitest";
import { expandControlEvidence, type QEdge, type QNode } from "@/lib/graph/query";

const node = (id: string, label: string, source_doc = "REF-004"): QNode => ({
  id,
  label,
  name: id,
  classification: null,
  description: null,
  source_doc,
});
const edge = (source: string, relation: string, target: string, source_doc = "REF-004"): QEdge => ({
  source,
  relation,
  target,
  condition: null,
  source_doc,
});

describe("control evidence expansion (R-09)", () => {
  const result = {
    nodes: [node("SYS-CRM", "System"), node("DC-CUST-PII", "DataClass"), node("CTL-07", "Control")],
    edges: [edge("SYS-CRM", "stores", "DC-CUST-PII"), edge("DC-CUST-PII", "requires", "CTL-07")],
  };
  const implementedBy = [edge("CTL-07", "implemented_by", "PROC-REVIEW", "PRC-019")];

  it("adds a Control node's implemented_by edge one step past the hop limit", () => {
    const out = expandControlEvidence(result, implementedBy);
    expect(out.edges).toContainEqual(edge("CTL-07", "implemented_by", "PROC-REVIEW", "PRC-019"));
    expect(out.edges).toHaveLength(3);
    expect(out.newNodeIds).toEqual(["PROC-REVIEW"]);
  });

  it("only follows implemented_by from Control nodes in the result", () => {
    const out = expandControlEvidence(result, [
      edge("CTL-99", "implemented_by", "PROC-X"), // control not in result
      edge("CTL-07", "uses", "SYS-IAM"), // not implemented_by
    ]);
    expect(out.edges).toEqual(result.edges);
    expect(out.newNodeIds).toEqual([]);
  });

  it("does not duplicate an edge already present, nor refetch known nodes", () => {
    const withProc = {
      nodes: [...result.nodes, node("PROC-REVIEW", "Process", "PRC-019")],
      edges: [...result.edges, edge("CTL-07", "implemented_by", "PROC-REVIEW", "PRC-019")],
    };
    const out = expandControlEvidence(withProc, implementedBy);
    expect(out.edges).toHaveLength(3);
    expect(out.newNodeIds).toEqual([]);
  });

  it("is a no-op without Control nodes", () => {
    const out = expandControlEvidence(
      { nodes: [node("SYS-CRM", "System")], edges: [] },
      implementedBy,
    );
    expect(out).toEqual({ edges: [], newNodeIds: [] });
  });
});
