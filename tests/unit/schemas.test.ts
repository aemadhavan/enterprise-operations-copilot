import { describe, expect, it } from "vitest";
import { FinalAnswer, jsonSchemaFor, ROUTE_FOR_INTENT, RouterOutput } from "@/lib/agent/schemas";

describe("schemas (contracts/answer-schema.md)", () => {
  it("maps every intent to the FR-005a route", () => {
    expect(ROUTE_FOR_INTENT).toEqual({
      lookup: "text",
      entity: "graph_local",
      impact: "graph_traversal",
      action: "action",
      unsafe: "refuse",
      ambiguous: "clarify",
    });
  });

  it("accepts a valid router output and rejects extra fields", () => {
    const ok = {
      intent: "impact",
      entities: [{ kind: "system", mention: "Atlas CRM" }],
      requester_type: "Contractor",
      missing_fields: [],
      rationale: "Asks for approvals across policies.",
    };
    expect(RouterOutput.parse(ok)).toEqual(ok);
    expect(() => RouterOutput.parse({ ...ok, risk: "high" })).toThrow();
  });

  it("accepts doc and edge citations in a final answer", () => {
    const a = {
      behaviour: "answer",
      claims: [
        {
          text: "Max 90 days.",
          key: true,
          citations: [
            { doc_id: "POL-014", section: "3. Requirements > 3.4" },
            {
              edge: {
                source: "SYS-CRM",
                relation: "data_owner",
                target: "PER-TGALLAGHER",
                source_doc: "REF-003",
              },
            },
          ],
          source_status: "effective_policy",
        },
      ],
      assumptions: [],
      gaps: [],
      clarifying_question: null,
      legitimate_path: null,
    };
    expect(FinalAnswer.parse(a)).toEqual(a);
  });

  it("produces strict JSON Schemas for structured outputs", () => {
    const s = jsonSchemaFor(FinalAnswer) as { additionalProperties: boolean; required: string[] };
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(
      expect.arrayContaining(["behaviour", "claims", "assumptions", "gaps"]),
    );
    expect(JSON.stringify(jsonSchemaFor(RouterOutput))).not.toContain('"$schema"');
  });
});
