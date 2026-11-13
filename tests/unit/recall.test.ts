import { describe, expect, it } from "vitest";
import { recallAt5, retrievedDocSet } from "@/evaluation/runner/metrics/recall";

const ranked = (...ids: string[]) => ids.map((doc_id) => ({ doc_id }));

describe("recall@5 (SC-010, clarification 1)", () => {
  it("uses the top 5 distinct doc IDs, not the top 5 chunks", () => {
    const set = retrievedDocSet(ranked("A", "A", "A", "B", "C", "D", "E", "F"));
    expect([...set]).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("adds every returned edge source_doc on graph routes", () => {
    const set = retrievedDocSet(ranked("A", "B", "C", "D", "E", "F"), [
      { source_doc: "REF-005" },
      { source_doc: "A" },
      { source_doc: "PRC-012" },
    ]);
    expect([...set].sort()).toEqual(["A", "B", "C", "D", "E", "PRC-012", "REF-005"]);
  });

  it("scores found ÷ min(5, |expected|)", () => {
    expect(recallAt5(["POL-014"], ranked("POL-014", "X"))).toBe(1);
    expect(recallAt5(["POL-014", "PRC-012"], ranked("POL-014", "X"))).toBe(0.5);
    expect(recallAt5(["Z"], ranked("A", "B", "C", "D", "E", "Z"))).toBe(0);
  });

  it("caps the denominator at 5 when more than 5 sources are expected", () => {
    const expected = ["A", "B", "C", "D", "E", "F", "G"];
    expect(recallAt5(expected, ranked("A", "B", "C", "D", "E"))).toBe(1);
    // graph edges can push found above 5; the score is capped at 1
    expect(
      recallAt5(expected, ranked("A", "B", "C", "D", "E"), [
        { source_doc: "F" },
        { source_doc: "G" },
      ]),
    ).toBe(1);
  });

  it("returns null (skipped) when expected_sources is empty", () => {
    expect(recallAt5([], ranked("A"))).toBeNull();
  });

  it("counts duplicate expected IDs once", () => {
    expect(recallAt5(["A", "A"], ranked("A"))).toBe(1);
  });
});
