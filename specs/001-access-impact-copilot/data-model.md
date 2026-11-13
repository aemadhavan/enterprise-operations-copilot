# Data Model: Access Impact Copilot

Postgres (Neon) with the `vector` extension. Every table includes `created_at timestamptz default now()`.

## Knowledge (loaded from fixtures; read-only at runtime)

### documents (FR-001)
| Field | Type | Notes |
|---|---|---|
| doc_id | text PK | e.g. `POL-014` |
| title, doc_type, version, owner, source_system | text | From front matter. `doc_type` ∈ policy, procedure, reference, standard, incident, meeting_notes (the fixture value) |
| effective_date | date null | Documents with no effective date (e.g. `MTG-*`) are treated as discussion material (FR-008) |
| is_authoritative | bool | `doc_type <> 'meeting_notes'` |
| content_hash | text | Used to detect fixture drift |

### chunks (FR-001, FR-004)
| Field | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| doc_id | text FK → documents | |
| section | text | Heading path, e.g. `3. Requirements > 3.4`. Clause-level: each numbered clause bullet (`- **3.4** ...`) is its own chunk; each Markdown table row is its own chunk with section `<heading path> > <first cell>` (e.g. `Control Catalogue > CTL-08`); text under the `#` title before the first `##` uses the title as its section (R-07) |
| text | text | |
| tsv | tsvector | `to_tsvector('english', section || ' ' || text)`, GIN index |
| embedding | vector(1024) | HNSW cosine index |
| embedding_model | text | Must equal the configured model, otherwise ingest fails (ADR-007) |

### nodes / edges (FR-002, FR-005b)
`nodes(id text PK, label text, name text, classification text null, description text, source_doc text FK)`. Indexes on `label` and `classification`.

`edges(id bigserial PK, source text FK→nodes, relation text, target text FK→nodes, condition text null, source_doc text FK)`. Indexes on `(source, relation)`, `(target, relation)` and `relation`.

Validation: `relation` must be one of the 15 relations in `data/graph_seed/README.md`. `condition` is parsed as `key=value[|value]` (e.g. `classification=Confidential|Restricted`, `requester=Contractor`).

## Runtime

### drafts (FR-009, FR-010, clarifications 2 and 4)
| Field | Type | Notes |
|---|---|---|
| draft_id | uuid PK | |
| lineage_id | uuid | Shared by every version of the same request |
| version | int | Starts at 1, plus 1 per edit; unique on (lineage_id, version) |
| kind | text | `access_request` or `onboarding_ticket` |
| payload | jsonb | Validated by the Zod schema for its kind (contracts/mcp-tools.md) |
| approval_chain | jsonb | Resolved from REF-005 and the data-owner edge, in PRC-012 §3 order |
| warnings | jsonb | e.g. `separation_of_duties`, `vendor_assessment_expires_before_end` |
| policy_citations | text[] | |
| status | text | `proposed` → `confirmed` \| `cancelled` \| `superseded` |
| conversation_id | text | |

State transitions (enforced in code and by a check trigger):
```
proposed ──confirm──▶ confirmed   (exactly once; access_requests.draft_id UNIQUE)
proposed ──cancel───▶ cancelled
proposed ──edit─────▶ superseded  (and a new draft version is created, status = proposed)
confirmed / cancelled / superseded: terminal
```
A draft is only created when the policy check passes and no required field is missing (FR-009, FR-011). A blocked attempt produces an audit `blocked` row, not a draft.

### access_requests (FR-010, FR-024)
`request_id text PK` (`AR-0001`, generated from a sequence), `draft_id uuid UNIQUE FK` (this is the idempotency key), `payload jsonb`, `sla_business_days int` (2 or 5), `status text` (`pending_approvals` → `approved` | `rejected` | `expired`), `workflow_run_id text`, `confirmed_by text` (stated by the user, unverified).

### onboarding_tickets (FR-026)
`ticket_id text PK` (`TKT-0001`), `draft_id uuid UNIQUE FK`, `contractor_name`, `vendor null`, `sponsor`, `start_date date`, `end_date date`, `restricted_access_expected bool`, `vendor_flag jsonb null`, `status` (`open`). There's no approval workflow: action confirmation only.

### approval_steps (FR-024, FR-024a)
`id`, `request_id FK`, `seq int`, `role` (`sponsor`, `data_owner`, `security_governance`, `privacy_officer`, `finance_systems_lead`), `approver_name`, `status` (`pending` → `approved` | `rejected` | `sla_breached`), `decided_at`, `decided_via` (`simulated_approver_panel` only). Unique on `(request_id, seq)`.

### audit_log (FR-015, Constitution IV): append-only
| Field | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| at | timestamptz | |
| actor | text | Stated identity, labelled `unverified` |
| event | text | `proposed`, `blocked`, `superseded`, `cancelled`, `confirmed`, `executed`, `step_approved`, `step_rejected`, `sla_breached`, `request_completed` |
| draft_id / request_id / ticket_id | null FKs | |
| details | jsonb | Redacted before insert |
| policy_citations | text[] | |

`REVOKE UPDATE, DELETE` from the app role, plus a `BEFORE UPDATE OR DELETE` trigger that raises an error.

### Traces (Langfuse, not stored in Postgres)
One trace per turn: `conversation_id`, intent, risk, route, retrieved `(doc_id, section, rank)`, graph edges, tool calls (name, risk, args redacted), draft IDs, answer behaviour, confidence, latency_ms, input/output/cached tokens, cost_usd, provider and model.

## Entity relationships
```
documents 1─* chunks
documents 1─* nodes.source_doc, edges.source_doc
drafts *─1 lineage (versions) ; drafts 1─0..1 access_requests | onboarding_tickets
access_requests 1─* approval_steps
audit_log *─0..1 drafts / access_requests / onboarding_tickets
```
