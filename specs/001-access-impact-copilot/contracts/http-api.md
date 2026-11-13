# Contract: HTTP API (Next.js route handlers)

All routes are server-only, have no auth (PoC), and are rate-limited per IP (`DEMO_RATE_LIMIT_PER_MIN`) with a daily spend cap (`DEMO_DAILY_SPEND_CAP_USD`). Errors use `{ error: { code, message } }`. If the model or database is unavailable, the route returns `503 { code: "upstream_unavailable" }` and never a half-executed action.

## POST /api/chat
Request: `{ conversation_id: string, message: string, stated_identity?: string, mode?: "graphrag" | "baseline" }`
Response `200` (also streamable as SSE: `status` events, then `final`):
```json
{
  "route": "graph_traversal",
  "intent": "impact", "risk": "high",
  "answer": { "markdown": "…", "claims": [...], "assumptions": [...], "gaps": [...], "confidence": "high", "behaviour": "answer" },
  "citations": [{ "doc_id": "REF-005", "section": "1" }],
  "graph_path": { "nodes": [...], "edges": [...] },
  "draft": null,
  "trace_id": "…", "latency_ms": 3800, "cost_usd": 0.012
}
```
When `behaviour = "draft"`, `draft` holds `{ draft_id, version, kind, payload, approval_chain, warnings, policy_citations }`. The schema is in [answer-schema.md](./answer-schema.md).

## POST /api/drafts/{draft_id}/confirm  (action confirmation, FR-010)
Request: `{ confirmed_by: string }` (stated identity, unverified). Only the UI Submit button calls this route.
- `proposed` → executes the write tool → `200 { request_id | ticket_id, status, idempotent_replay: false }`
- already `confirmed` → `200` with the same IDs and `idempotent_replay: true` (no second execution)
- `superseded` / `cancelled` → `409 { code: "draft_not_submittable" }`
- policy re-check fails at confirm time (e.g. a vendor assessment expired since drafting) → `409 { code: "policy_check_failed", breaches }`, audit `blocked`, no execution (Constitution II)
- Writes audit `confirmed` + `executed`. For access requests, it emits `access_request.submitted` and starts the approval workflow (FR-024).

## POST /api/drafts/{draft_id}/cancel
`proposed` → `cancelled` (audit `cancelled`). Any other state → `409`.

## GET /api/requests/{request_id}
`{ request_id, status, sla_business_days, steps: [{ seq, role, approver_name, status, decided_at }], events: [...] }` drives the status timeline.

## POST /api/simulated-approver  (FR-024a, UI panel only)
Request: `{ request_id, role, decision: "approve" | "reject" }`. Requires the panel header `x-approver-panel: 1` plus a same-origin check. Requests carrying the agent context marker are rejected with `403`. This route resumes the workflow hook `${request_id}:${role}` and writes audit `step_approved` or `step_rejected`. **No agent tool can reach this route.** Tier 1a asserts this.

## GET /api/audit?limit=&draft_id=&request_id=
Read-only list of audit rows (redacted).

## Domain event: `access_request.submitted` (FR-024)
```json
{ "type": "access_request.submitted", "request_id": "AR-0001", "draft_id": "…",
  "request": { "requester_name": "Alex Chen", "system_id": "SYS-CRM", "access_level": "read", "duration_days": 90, "...": "…" },
  "approval_chain": [{ "seq": 1, "role": "sponsor", "approver_name": "Tom Gallagher" }, "…"],
  "sla_business_days": 5, "emitted_at": "…" }
```
