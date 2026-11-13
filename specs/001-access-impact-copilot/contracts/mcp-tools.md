# Contract: MCP tools (in-process server, FR-014)

Every tool declares `name`, `description`, `inputSchema` (JSON Schema generated from Zod; `strict: true`, `additionalProperties: false`), `risk` (`read` | `propose` | `write`) and `allowed_roles`. Output is JSON. Tool inputs are parsed with Zod again before execution (LLM05).

| Tool | Risk | Who may call it | Purpose |
|---|---|---|---|
| `search_documents` | read | agent | Hybrid retrieval (FR-004) |
| `get_section` | read | agent | Fetch one section's full text for citation |
| `graph_query` | read | agent | Graph traversal with three seed modes (FR-005b) |
| `lookup_approvals` | read | agent | Resolve the REF-005 approval chain plus named approvers for a system and requester type |
| `check_policy` | read | agent | Deterministic checks: duration max, contractor admin, vendor assessment validity |
| `propose_access_request` | propose | agent | Creates or supersedes a **draft** row only (FR-009); no business record changes |
| `propose_onboarding_ticket` | propose | agent | Creates or supersedes a **draft** row only (FR-026); no business record changes |
| `create_access_request` | **write** | `confirm` route only | Executes a confirmed draft (FR-010) |
| `create_onboarding_ticket` | **write** | `confirm` route only | Executes a confirmed draft (FR-026) |

**Gate (FR-010):** the agent's tool list never contains a `write` tool. The MCP client used by the agent loop is built with the filter `risk === 'read' || risk === 'propose'` (an allow-list, so an unknown or missing risk value is excluded). `propose` tools may insert `drafts` rows and set an earlier version's status to `superseded`; they never touch `access_requests`, `onboarding_tickets`, `approval_steps` or the workflow. The server also rejects `write` calls unless the call context carries a valid `ConfirmationEvent {draft_id, confirmed_by, at}` created by `POST /api/drafts/{id}/confirm`. There is no tool that resumes approval hooks (FR-024a).

## Schemas (abridged)

```ts
search_documents { query: string; k?: number /*≤10, default 8*/; mode?: "baseline" | "graphrag" }
  → { results: { doc_id, section, text, score, doc_type, effective_date }[] }

get_section { doc_id: string; section: string } → { doc_id, section, text, version, effective_date }

graph_query
  { mode: "node"; start_id: string; max_hops?: 1|2|3|4; relations?: Relation[] }
| { mode: "label"; label: NodeLabel; classification?: "Public"|"Internal"|"Confidential"|"Restricted"; condition?: string }
| { mode: "relation"; relation: Relation; limit?: number }
  → { nodes: Node[]; edges: { source, relation, target, condition, source_doc }[] }
  // Every mode: for each Control node in the result, its `implemented_by` edges (and target nodes)
  // are added one extra step, regardless of max_hops.

lookup_approvals { system_id: string; requester_type: "Employee"|"Contractor"|"Vendor"; access_level: "read"|"write"|"admin" }
  → { classification, chain: { seq, role, approver_name|null, source_doc }[], controls: { id, name, source_doc }[], prerequisites: {...}[] }

check_policy { system_id?, requester_type, access_level?, duration_days?, vendor?, start_date?, end_date? }
  → { ok: boolean; breaches: { rule, limit, value, citation, alternative }[]; warnings: {...}[] }   // "today" = 2026-11-13

propose_access_request {
  requester_name: string; requester_type: "Employee"|"Contractor"|"Vendor"; sponsor: string;
  system_id: string; access_level: "read"|"write"|"admin"; duration_days: number; justification: string;
  vendor?: string; supersedes_draft_id?: string }
  → { status: "drafted"; draft } | { status: "needs_fields"; missing: string[] } | { status: "blocked"; breaches }

propose_onboarding_ticket {
  contractor_name: string; vendor?: string; sponsor: string; start_date: string /*ISO*/;
  end_date: string; restricted_access_expected: boolean; supersedes_draft_id?: string }
  → same three shapes; drafted output includes vendor_flag when the assessment is expired or expires before end_date (VND-002)

create_access_request { draft_id: uuid } (+ ConfirmationEvent in context)
  → { request_id: "AR-0001", status: "pending_approvals", approval_chain, sla_business_days, idempotent_replay: boolean }

create_onboarding_ticket { draft_id: uuid } (+ ConfirmationEvent in context)
  → { ticket_id: "TKT-0001", status: "open", idempotent_replay: boolean }
```

`propose_*` re-runs `check_policy` and the missing-fields check in code. It never relies on the model having done so.
