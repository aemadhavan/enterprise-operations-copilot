import { describe, expect, it } from "vitest";
import { expandCaseRanges, parseArgs, selectCases } from "@/evaluation/runner/cli";
import { evaluateGates, findRegressions } from "@/evaluation/runner/report";

const golden = [
  { id: "GS-001", category: "direct", expected_sources: ["POL-014"] },
  { id: "GS-002", category: "direct", expected_sources: ["POL-030"] },
  { id: "GS-009", category: "multi_hop", expected_sources: ["REF-005"] },
  { id: "GS-018", category: "grounding", expected_sources: [] },
] as never[];

describe("eval CLI (FR-018, FR-022)", () => {
  it("expands GS ranges and single IDs", () => {
    expect(expandCaseRanges("GS-001..GS-003,GS-018")).toEqual([
      "GS-001",
      "GS-002",
      "GS-003",
      "GS-018",
    ]);
  });

  it("parses flags with defaults", () => {
    expect(parseArgs(["--tier", "1a"])).toMatchObject({
      tier: "1a",
      mode: "both",
      runs: 1,
      arms: ["hybrid"],
      milestone: "M2",
    });
    const a = parseArgs(["--tier", "1a", "--mode", "baseline", "--arms", "all", "--runs", "3"]);
    expect(a).toMatchObject({ mode: "baseline", runs: 3, arms: ["hybrid", "fts", "vector"] });
  });

  it("rejects unknown flags and values", () => {
    expect(() => parseArgs(["--tier", "9"])).toThrow(/tier/);
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown/);
  });

  it("selects by explicit cases, by category, or by the milestone default", () => {
    expect(selectCases(golden, parseArgs(["--cases", "GS-001,GS-009"])).map((c) => c.id)).toEqual([
      "GS-001",
      "GS-009",
    ]);
    expect(selectCases(golden, parseArgs(["--category", "direct"])).map((c) => c.id)).toEqual([
      "GS-001",
      "GS-002",
    ]);
    // M2 default: GS-001..008 + GS-018..020
    expect(selectCases(golden, parseArgs([])).map((c) => c.id)).toEqual([
      "GS-001",
      "GS-002",
      "GS-018",
    ]);
  });
});

describe("gates and regression guard (Constitution III/VIII)", () => {
  it("gates graphrag recall@5 at ≥ 90% from M2, ignoring skipped cases", () => {
    const pass = evaluateGates("M2", [
      { case_id: "a", mode: "graphrag", arm: "hybrid", recall_at_5: 1 },
      { case_id: "b", mode: "graphrag", arm: "hybrid", recall_at_5: null },
    ]);
    expect(pass.passed).toBe(true);
    const fail = evaluateGates("M2", [
      { case_id: "a", mode: "graphrag", arm: "hybrid", recall_at_5: 1 },
      { case_id: "b", mode: "graphrag", arm: "hybrid", recall_at_5: 0.5 },
    ]);
    expect(fail.passed).toBe(false);
    expect(fail.gates[0]).toMatchObject({
      metric: "recall_at_5",
      value: 0.75,
      threshold: 0.9,
      gated: true,
    });
  });

  it("reports baseline without gating it", () => {
    const g = evaluateGates("M3", [
      { case_id: "a", mode: "baseline", arm: "hybrid", recall_at_5: 0.4 },
      { case_id: "a", mode: "graphrag", arm: "hybrid", recall_at_5: 1 },
    ]);
    expect(g.passed).toBe(true);
    expect(g.gates.find((x) => x.mode === "baseline")).toMatchObject({ gated: false, value: 0.4 });
  });

  it("only gates the hybrid arm; fts/vector are diagnostic", () => {
    const g = evaluateGates("M2", [
      { case_id: "a", mode: "graphrag", arm: "hybrid", recall_at_5: 1 },
      { case_id: "a", mode: "graphrag", arm: "fts", recall_at_5: 0 },
    ]);
    expect(g.passed).toBe(true);
  });

  it("flags a graphrag case whose score dropped below its last passing score; baseline is not guarded", () => {
    const last = { "GS-001|graphrag": 1, "GS-002|graphrag": 0.5, "GS-003|baseline": 1 };
    expect(
      findRegressions(last, [
        { case_id: "GS-001", mode: "graphrag", arm: "hybrid", recall_at_5: 0.5 },
        { case_id: "GS-002", mode: "graphrag", arm: "hybrid", recall_at_5: 1 },
        { case_id: "GS-003", mode: "baseline", arm: "hybrid", recall_at_5: 0 },
      ]),
    ).toEqual([{ key: "GS-001|graphrag", previous: 1, current: 0.5 }]);
  });
});
