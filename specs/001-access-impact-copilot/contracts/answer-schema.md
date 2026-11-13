# Contract: model output schemas (structured outputs, `output_config.format`)

## Router output (FR-003, FR-005a)
```ts
{
  intent: "lookup" | "entity" | "impact" | "action" | "unsafe" | "ambiguous",
  entities: { kind: "system" | "data_class" | "person" | "vendor" | "policy" | "process", mention: string }[],
  requester_type: "Employee" | "Contractor" | "Vendor" | null,
  missing_fields: string[],          // only meaningful for action / ambiguous
  rationale: string                  // ≤ 30 words, trace only
}
```
`risk` is computed in code, not by the model: `high` if intent ∈ {action, unsafe} or any resolved entity is Restricted (a graph lookup); otherwise `low`. Unit-tested (FR-003).
The route is taken from the fixed map: lookup→text, entity→graph_local, impact→graph_traversal, action→action, unsafe→refuse, ambiguous→clarify.

## Final answer (FR-006–FR-008, clarification 3)
```ts
{
  behaviour: "answer" | "state_gap" | "clarify" | "refuse" | "draft",
  claims: {
    text: string,
    key: boolean,                                  // central to the answer
    citations: ({ doc_id: string, section: string } | { edge: { source: string, relation: string, target: string, source_doc: string } })[],
    source_status: "effective_policy" | "proposal_or_meeting"
  }[],
  assumptions: string[],
  gaps: string[],
  clarifying_question: string | null,              // exactly one when behaviour = clarify (FR-013)
  legitimate_path: string | null                   // when behaviour = refuse (FR-012)
}
```

### Post-processing in code
1. Drop any citation whose `doc_id`/section or edge was not in this turn's retrieved set. A claim left with no citations becomes *uncited*.
2. **Confidence**: `low` if any `key` claim is uncited, if citations conflict, or if a key claim rests only on `proposal_or_meeting`. Otherwise `medium` if `assumptions` or `gaps` is non-empty. Otherwise `high`.
3. Render Markdown from the claims, with citation chips. Sanitise (no raw HTML, LLM05).
