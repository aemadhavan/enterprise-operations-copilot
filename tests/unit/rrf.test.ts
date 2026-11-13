import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "@/lib/retrieval/hybrid";

describe("reciprocalRankFusion (R-07, k = 60)", () => {
  it("scores each id as the sum of 1 / (k + rank) across lists", () => {
    const fused = reciprocalRankFusion(
      [
        ["a", "b"],
        ["b", "c"],
      ],
      60,
    );
    const score = Object.fromEntries(fused.map((f) => [f.id, f.score]));
    expect(score.a).toBeCloseTo(1 / 61);
    expect(score.b).toBeCloseTo(1 / 62 + 1 / 61);
    expect(score.c).toBeCloseTo(1 / 62);
    expect(fused.map((f) => f.id)).toEqual(["b", "a", "c"]);
  });

  it("records the rank in each list (null when absent)", () => {
    const fused = reciprocalRankFusion([["a"], ["b", "a"]], 60);
    expect(fused.find((f) => f.id === "a")?.ranks).toEqual([1, 2]);
    expect(fused.find((f) => f.id === "b")?.ranks).toEqual([null, 1]);
  });

  it("breaks score ties deterministically by best rank, then id", () => {
    const fused = reciprocalRankFusion(
      [
        ["x", "y"],
        ["y", "x"],
      ],
      60,
    );
    expect(fused.map((f) => f.id)).toEqual(["x", "y"]);
  });

  it("handles empty lists", () => {
    expect(reciprocalRankFusion([[], []], 60)).toEqual([]);
    expect(reciprocalRankFusion([[], ["a"]], 60).map((f) => f.id)).toEqual(["a"]);
  });
});
