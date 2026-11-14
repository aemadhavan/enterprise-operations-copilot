import { describe, expect, it } from "vitest";
import { FinalAnswer, jsonSchemaFor, ROUTE_FOR_INTENT, RouterOutput } from "@/lib/agent/schemas";
import { proposeTools } from "@/lib/mcp/tools/propose";
import { readTools, SearchDocumentsInput } from "@/lib/mcp/tools/read";

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
    const toolSchema = JSON.stringify(jsonSchemaFor(SearchDocumentsInput));
    expect(toolSchema).not.toContain('"minimum"');
    expect(toolSchema).not.toContain('"maximum"');
    expect(toolSchema).not.toContain('"minLength"');
  });

  it("keeps total optional parameters across all agent strict schemas <= 24 (Anthropic grammar limit)", () => {
    const countOptional = (schema: Record<string, unknown>): number => {
      const props = Object.keys((schema.properties as Record<string, unknown>) ?? {});
      const req = new Set((schema.required as string[]) ?? []);
      return props.filter((k) => !req.has(k)).length;
    };
    const allTools = [...readTools(), ...proposeTools()];
    const totalOptional =
      allTools.reduce((sum, t) => sum + countOptional(jsonSchemaFor(t.input)), 0) +
      countOptional(jsonSchemaFor(FinalAnswer));
    expect(totalOptional).toBeLessThanOrEqual(24);
  });
});
