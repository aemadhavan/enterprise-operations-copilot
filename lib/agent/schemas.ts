import { z } from "zod";

/** contracts/answer-schema.md. Strict objects: structured outputs need additionalProperties: false. */

// ---------- Router output (FR-003, FR-005a) ----------
export const Intent = z.enum(["lookup", "entity", "impact", "action", "unsafe", "ambiguous"]);
export type Intent = z.infer<typeof Intent>;

export const EntityKind = z.enum(["system", "data_class", "person", "vendor", "policy", "process"]);

export const RouterOutput = z.strictObject({
  intent: Intent,
  entities: z.array(z.strictObject({ kind: EntityKind, mention: z.string() })),
  requester_type: z.enum(["Employee", "Contractor", "Vendor"]).nullable(),
  missing_fields: z.array(z.string()),
  rationale: z.string(), // ≤ 30 words, trace only
});
export type RouterOutput = z.infer<typeof RouterOutput>;

export const Route = z.enum([
  "text",
  "graph_local",
  "graph_traversal",
  "action",
  "refuse",
  "clarify",
]);
export type Route = z.infer<typeof Route>;

/** Fixed intent → route map (FR-005a). Never invent new route names. */
export const ROUTE_FOR_INTENT: Record<Intent, Route> = {
  lookup: "text",
  entity: "graph_local",
  impact: "graph_traversal",
  action: "action",
  unsafe: "refuse",
  ambiguous: "clarify",
};

// ---------- Final answer (FR-006–FR-008, clarification 3) ----------
export const DocCitation = z.strictObject({ doc_id: z.string(), section: z.string() });
export const EdgeCitation = z.strictObject({
  edge: z.strictObject({
    source: z.string(),
    relation: z.string(),
    target: z.string(),
    source_doc: z.string(),
  }),
});
export const Citation = z.union([DocCitation, EdgeCitation]);
export type Citation = z.infer<typeof Citation>;

export const Behaviour = z.enum(["answer", "state_gap", "clarify", "refuse", "draft"]);
export type Behaviour = z.infer<typeof Behaviour>;

export const Claim = z.strictObject({
  text: z.string(),
  key: z.boolean(), // central to the answer
  citations: z.array(Citation),
  source_status: z.enum(["effective_policy", "proposal_or_meeting"]),
});
export type Claim = z.infer<typeof Claim>;

export const FinalAnswer = z.strictObject({
  behaviour: Behaviour,
  claims: z.array(Claim),
  assumptions: z.array(z.string()),
  gaps: z.array(z.string()),
  clarifying_question: z.string().nullable(), // exactly one when behaviour = clarify (FR-013)
  legitimate_path: z.string().nullable(), // when behaviour = refuse (FR-012)
});
export type FinalAnswer = z.infer<typeof FinalAnswer>;

export type Confidence = "low" | "medium" | "high";

/** JSON Schema for `output_config.format` (Zod 4 native conversion). */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  void _ignored;
  return rest;
}
