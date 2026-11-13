import { describe, expect, it } from "vitest";
import { sourceCoverage } from "@/evaluation/runner/metrics/coverage";
import { recallAt5 } from "@/evaluation/runner/metrics/recall";

const ranked = (...ids: string[]) => ids.map((doc_id) => ({ doc_id }));

describe("source coverage (reported, not gated)", () => {
  it("is found ÷ expected, with no min(5) cap", () => {
    const expected = ["A", "B", "C", "D", "E", "F"];
    const r = ranked("A", "B", "C", "D", "E");
    expect(sourceCoverage(expected, r)).toBeCloseTo(5 / 6);
    expect(recallAt5(expected, r)).toBe(1); // recall@5 caps the denominator at 5
  });

  it("uses the same retrieved set as recall@5 (top 5 distinct docs + graph source_docs)", () => {
    expect(sourceCoverage(["F"], ranked("A", "B", "C", "D", "E", "F"))).toBe(0);
    expect(sourceCoverage(["F", "A"], ranked("A"), [{ source_doc: "F" }])).toBe(1);
  });

  it("is null when nothing is expected and counts duplicates once", () => {
    expect(sourceCoverage([], ranked("A"))).toBeNull();
    expect(sourceCoverage(["A", "A", "B"], ranked("A"))).toBe(0.5);
  });
});
