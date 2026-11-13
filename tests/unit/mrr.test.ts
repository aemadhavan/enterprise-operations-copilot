import { describe, expect, it } from "vitest";
import { reciprocalRank } from "@/evaluation/runner/metrics/mrr";

const ranked = (...ids: string[]) => ids.map((doc_id) => ({ doc_id }));

describe("reciprocal rank (reported, not gated)", () => {
  it("is 1 / rank of the first expected doc among distinct doc IDs", () => {
    expect(reciprocalRank(["POL-014"], ranked("POL-014", "X"))).toBe(1);
    expect(reciprocalRank(["B"], ranked("A", "A", "B"))).toBe(0.5);
    expect(reciprocalRank(["C", "B"], ranked("A", "B", "C"))).toBe(0.5);
  });

  it("is 0 when no expected doc is retrieved and null when nothing is expected", () => {
    expect(reciprocalRank(["Z"], ranked("A", "B"))).toBe(0);
    expect(reciprocalRank([], ranked("A"))).toBeNull();
  });
});
