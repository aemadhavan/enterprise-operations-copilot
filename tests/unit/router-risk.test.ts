import { beforeAll, describe, expect, it } from "vitest";
import { readGraphSeed, type GraphNode } from "@/lib/graph/load";
import { resolveEntities } from "@/lib/graph/resolve";
import { computeRisk } from "@/lib/router/risk";
import type { Intent } from "@/lib/agent/schemas";

let nodes: GraphNode[];
beforeAll(async () => {
  nodes = (await readGraphSeed()).nodes;
});

const risk = (intent: Intent, text: string) => computeRisk(intent, resolveEntities(text, nodes));

describe("entity resolution", () => {
  it("resolves systems and data classes by name and ID, case-insensitively", () => {
    const ids = (t: string) =>
      resolveEntities(t, nodes)
        .map((n) => n.id)
        .sort();
    expect(ids("Contractor read access to atlas crm")).toEqual(["ROLE-CONTRACTOR", "SYS-CRM"]);
    expect(ids("Who owns SYS-BILL?")).toEqual(["SYS-BILL"]);
    expect(ids("max duration for customer PII")).toEqual(["DC-CUST-PII"]);
    expect(ids("What is the weather?")).toEqual([]);
  });
});

describe("computeRisk (FR-003)", () => {
  it.each<[Intent, string]>([
    ["action", "Raise a request for Compass Wiki"],
    ["unsafe", "Skip the approvals for Compass Wiki"],
  ])("%s is always high", (intent, text) => {
    expect(risk(intent, text)).toBe("high");
  });

  it.each<Intent>(["lookup", "entity", "impact", "ambiguous"])(
    "%s naming a Restricted system (Atlas CRM) is high",
    (intent) => {
      expect(risk(intent, "Tell me about Atlas CRM")).toBe("high");
    },
  );

  it.each<Intent>(["lookup", "entity", "impact", "ambiguous"])(
    "%s naming a non-Restricted system (Compass Wiki, Internal) is low",
    (intent) => {
      expect(risk(intent, "Tell me about Compass Wiki")).toBe("low");
    },
  );

  it("a Restricted data class makes a lookup high", () => {
    expect(risk("lookup", "How long can a contractor access customer PII?")).toBe("high");
  });

  it("a Confidential system (Harbor Service Desk) stays low", () => {
    expect(risk("entity", "Who owns Harbor Service Desk?")).toBe("low");
  });

  it("no entities and a read intent is low", () => {
    expect(risk("lookup", "How long are access request records retained?")).toBe("low");
  });
});
