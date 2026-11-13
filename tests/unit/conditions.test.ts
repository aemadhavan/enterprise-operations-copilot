import { describe, expect, it } from "vitest";
import { conditionApplies, highestClassification, parseCondition } from "@/lib/graph/conditions";

describe("edge conditions (key=value[|value])", () => {
  it("parses key=value lists", () => {
    expect(parseCondition("classification=Confidential|Restricted")).toEqual({
      kind: "filter",
      key: "classification",
      values: ["Confidential", "Restricted"],
    });
    expect(parseCondition("requester=Contractor")).toEqual({
      kind: "filter",
      key: "requester",
      values: ["Contractor"],
    });
  });

  it("treats empty as always and free text as a note", () => {
    expect(parseCondition(null)).toEqual({ kind: "always" });
    expect(parseCondition("")).toEqual({ kind: "always" });
    expect(parseCondition("or delegate")).toEqual({ kind: "note", text: "or delegate" });
  });

  it("applies filters against the request context", () => {
    const ctx = { classification: "Restricted", requester: "Contractor" } as const;
    expect(conditionApplies("classification=Confidential|Restricted", ctx)).toBe(true);
    expect(conditionApplies("classification=Internal", ctx)).toBe(false);
    expect(conditionApplies("requester=Employee", ctx)).toBe(false);
    expect(conditionApplies("or delegate", ctx)).toBe(true);
    expect(conditionApplies(null, ctx)).toBe(true);
  });

  it("a filter on a key missing from the context does not apply", () => {
    expect(conditionApplies("requester=Contractor", { classification: "Restricted" })).toBe(false);
  });
});

describe("highestClassification (POL-001 §3)", () => {
  it("returns the max over stored data classes", () => {
    expect(highestClassification(["Internal", "Restricted", "Confidential"])).toBe("Restricted");
    expect(highestClassification(["Internal", "Confidential"])).toBe("Confidential");
    expect(highestClassification([null, "Public"])).toBe("Public");
    expect(highestClassification([])).toBeNull();
  });
});
