# Implementation Plan: Access Impact Copilot

**Branch**: `001-access-impact-copilot` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-access-impact-copilot/spec.md` (FR-001–FR-026, SC-001–SC-010, clarifications of 2026-11-13)

## Summary

A Next.js app on Vercel that answers access-governance questions about the fictional Kestrel Financial Group, with citations, assumptions, gaps and a confidence level. Each question goes to a router (intent → fixed route, FR-005a). Lookups use hybrid retrieval (Postgres full-text + pgvector, fused with reciprocal rank fusion). Entity and impact questions also traverse a curated graph stored in Postgres `nodes`/`edges` tables (recursive CTEs, three seed modes). A hand-written tool-use loop on the Anthropic SDK (or Bedrock) calls read tools on its own and *proposes* write tools. Write tools run only after a separate, code-enforced confirmation request, keyed on an immutable `draft_id`. On confirmation, a durable Vercel Workflow tracks the organisational approvals; it falls back to an in-memory state machine if needed. Evals (Tier 1a / 1b / 2) run the golden set in `baseline` and `graphrag` modes and gate CI.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 LTS. Python 3 only for the existing `scripts/validate_seed.py`.

**Primary Dependencies**: Next.js 15 (App Router), `dotenv` (scripts), `@anthropic-ai/sdk`, `@anthropic-ai/bedrock-sdk` (`AnthropicBedrockMantle`), `@modelcontextprotocol/sdk` (in-process server + client over an in-memory transport), `zod`, `@neondatabase/serverless`, `voyageai` (embeddings; Bedrock Titan V2 as the alternative), `workflow` (Vercel Workflow SDK), `langfuse`, `gray-matter` (front-matter parsing).

**Storage**: Neon Postgres with the `vector` extension. Tables: `documents`, `chunks` (tsvector + vector(1024)), `nodes`, `edges`, `drafts`, `access_requests`, `onboarding_tickets`, `approval_steps`, `audit_log` (append-only). See [data-model.md](./data-model.md).

**Testing**: Vitest for unit and integration tests. A custom eval runner (`evaluation/runner/`) provides `eval:fast` (1a), `eval:model` (1b) and `eval:full` (2). Playwright is optional, for one smoke test of the hero flow.

**Target Platform**: Vercel serverless functions (Node runtime), plus local dev with `next dev`.

**Project Type**: A single full-stack web application (Next.js), with a separate eval runner in the same repository.

**Performance Goals**: Q&A p95 ≤ 10 s (SC-008). Approval card rendered ≤ 1 s after the draft (PRD §8.2).

**Constraints**: Max 6 tool iterations and a token cap per request (LLM10). No sampling parameters; fixed model IDs and effort levels (R-03). Mean cost ≤ US$0.02/request (PRD §8.2), estimated at ≈ $0.006–0.015 with model tiering (R-02, ADR-010). Local secrets live in `.env.local`, which Next.js loads automatically and scripts load via `dotenv` (`path: '.env.local'`). Synthetic data only. Logs and traces are redacted before storage (FR-017).

**Scale/Scope**: 15 documents (~150 chunks), 66 nodes, 121 edges, 30 golden cases, one user role exercised, demo traffic only.

All unknowns are resolved in [research.md](./research.md). None remain marked NEEDS CLARIFICATION.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | How the design complies | Pre | Post |
|---|---|---|---|
| I. Grounded or Silent | The answer schema has structured claims, each with a citation (doc §, or an edge with `source_doc`). Confidence is computed in code (FR-006). `state_gap` happens when no evidence passes. Effective-dated docs outrank `MTG-*` via `doc_type` metadata (FR-008). | ✅ | ✅ |
| II. Human-in-the-Loop for Every Write | Write tools are never executed inside the agent loop. The loop can only *propose* a draft. Execution happens only at `POST /api/drafts/{id}/confirm`, a separate request driven by the UI. A DB unique key on `draft_id` makes it idempotent. Hook resumption is only possible at `/api/simulated-approver`, which rejects agent-context calls. The policy check runs before the draft is created. | ✅ | ✅ |
| III. Evals Are the Acceptance Tests | Tier 1a is built in M2. Tier 1b is built in M3. Tier 2 is built in M5. CI gates per spec §6. Case filters (FR-022). "No new task while a passing case fails" is enforced by comparing results to the last-passing snapshot. | ✅ | ✅ |
| IV. Observable by Default | A Langfuse trace per request covers intent, risk, route, retrievals, tool calls, approvals, answer, latency, tokens and cost. `audit_log` is append-only: `REVOKE UPDATE, DELETE` plus a trigger. | ✅ | ✅ |
| V. Least Privilege and Data Minimisation | `.env.example` only; `.env` and `.env.local` gitignored. Regex redaction is applied before every trace or log write. Tools declare `risk` (`read` | `propose` | `write`) and `allowed_roles`. | ✅ | ✅ |
| VI. Spec Is the Source of Truth | Every task maps to an FR. The "temperature 0" conflict (R-03) was resolved by amending the spec first (FR-020/FR-021, §6). | ✅ | ✅ |
| VII. Simplicity Over Platform | One repo, one database, an in-process MCP server and mock tools. ADRs 001–007 below each give a rejected alternative. | ✅ | ✅ |
| VIII. Honest Reporting | Results files record date, model, provider, embedding model, dataset hash and run index (×3 for 1b). Baseline wins are reported. | ✅ | ✅ |

**Gate result:** PASS.

## Architecture Decisions (ADRs)

| ADR | Decision | Rejected alternative, and why |
|---|---|---|
| 001 App | Next.js 15 App Router on Vercel, in TypeScript | Separate API + SPA: two deploys, no benefit at this size |
| 002 Data | Neon Postgres: pgvector + `tsvector` for hybrid retrieval; graph in `nodes`/`edges`, traversed with recursive CTEs | Neo4j or Neptune: 66 nodes don't justify a second datastore |
| 003 Agent runtime | Hand-written tool-use loop on `@anthropic-ai/sdk`; Bedrock via `AnthropicBedrockMantle`; `MODEL_PROVIDER` selects (FR-025) | Claude Agent SDK, which needs a persistent sandbox (bad fit for Vercel); the SDK Tool Runner, because the gate is clearer in our own loop |
| 004 Tools | In-process MCP server (`@modelcontextprotocol/sdk`, in-memory transport); each tool declares `risk` (`read` | `propose` | `write`) and `allowed_roles`; the agent client allow-lists `read` + `propose` | stdio child process, which doesn't work on serverless |
| 005 Graph tool | One `graph_query` tool with three seed modes (node + hops, label/classification/condition, relation) | Free-form SQL or Cypher from the model, which is unsafe and untestable |
| 006 Orchestration | Vercel Workflow: one hook per approver raced against an SLA `sleep()`, one step per transition; `APPROVAL_ENGINE=in-memory` fallback | A queue plus cron: more moving parts. Production equivalent: EventBridge + Step Functions |
| 007 Embeddings | One fixed embedding model, independent of `MODEL_PROVIDER`: Voyage `voyage-3.5` (1024-d) by default, Titan Text Embeddings V2 (1024-d) on Bedrock | Tying embeddings to the chat provider, which would silently invalidate the index and baseline |
| 008 Routing | The router is a single structured-output call (`output_config.format`, JSON schema), with deterministic pre-rules for obvious unsafe patterns | Forced `tool_choice`, which returns 400 on current models (R-04); keyword-only routing, which is too brittle for `entity` vs `impact` |
| 009 Write execution | The model proposes; code executes on a separate confirm request, idempotent on `draft_id` (DB unique) | Executing inside the loop after a "confirm" message, because the prompt could be injected into confirming |
| 010 Model tiering | Router `claude-haiku-5-5`; agent and answers `claude-sonnet-5-5`; judge `claude-opus-5-5` (env `ROUTER_MODEL`, `ANTHROPIC_MODEL`, `JUDGE_MODEL`). Cost ≈ $0.006–0.015 per request (R-02) | Opus everywhere: ≈ 2× cost (≈ $0.03–0.05 per graph request uncached), over the $0.02 target, and slower routing |

## Project Structure

### Documentation (this feature)

```text
specs/001-access-impact-copilot/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── http-api.md      # Next.js route handlers
│   ├── mcp-tools.md     # MCP tool names, schemas, risk levels
│   └── answer-schema.md # Structured answer, router output and draft shapes
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
app/                        # Next.js App Router
├── page.tsx                # Chat + evidence panel (PRD §6.1)
├── audit/page.tsx          # Audit log view
├── approver/page.tsx       # "Simulated approver" panel (FR-024a)
└── api/
    ├── chat/route.ts               # POST: one turn through router + agent loop
    ├── drafts/[id]/confirm/route.ts# POST: action confirmation → execute write tool
    ├── drafts/[id]/cancel/route.ts # POST
    ├── requests/[id]/route.ts      # GET: status timeline
    ├── simulated-approver/route.ts # POST: resume an approver hook (UI only)
    └── audit/route.ts              # GET
lib/
├── model/        # provider interface: anthropic.ts, bedrock.ts, index.ts (FR-025)
├── router/       # intent + risk classification, route map (FR-003, FR-005a)
├── retrieval/    # ingest.ts, hybrid.ts (RRF), embed.ts (ADR-007)
├── graph/        # load.ts, query.ts (3 seed modes, FR-005b)
├── agent/        # loop.ts (≤6 iterations), prompts/, answer.ts (claims → confidence)
├── mcp/          # server.ts (in-process), tools/*.ts, client.ts
├── policy/       # checks.ts (duration, vendor expiry, admin), approvals.ts (REF-005 resolver), sod.ts (FR-023)
├── drafts/       # drafts.ts (immutable versions), execute.ts (idempotent)
├── workflow/     # approval.workflow.ts (Vercel Workflow), in-memory.ts (fallback), engine.ts
├── audit/        # audit.ts (append-only writer)
├── observability/# langfuse.ts, redact.ts (FR-017)
└── db/           # client.ts, migrations/*.sql
scripts/
├── validate_seed.py        # existing
├── ingest.ts               # docs → chunks + embeddings; graph seed → nodes/edges
└── migrate.ts
evaluation/
├── golden_set.jsonl        # existing fixture
├── judges/                 # versioned judge prompts (Tier 2)
├── runner/                 # cli.ts, tier1a.ts, tier1b.ts, tier2.ts, metrics/*.ts, report.ts
└── results/
tests/
├── unit/                   # router risk labels, confidence rule, SoD, policy checks, redaction, recall@5 metric
└── integration/            # graph CTEs vs GS-009 path, confirmation gate, hook guard, idempotency
.github/workflows/
├── eval-fast.yml           # every push: validator + unit + Tier 1a
└── eval-pr.yml             # PRs to main: Tier 1b + Tier 2
```

**Structure Decision**: a single Next.js project, with server-only logic in `lib/` so the app, the eval runner and the tests share the same code paths. The eval runner calls `lib/` directly, not over HTTP, except for latency measurement.

## Request Flow (one chat turn)

1. `POST /api/chat` → redact the input for tracing → **router** (`ROUTER_MODEL`, structured output) returns `{intent, risk, entities, missing_fields}` → route chosen by the fixed FR-005a map.
2. `refuse` / `clarify` → a short model answer with no write tools offered. `text` → hybrid retrieval (top-k chunks), then the answer. `graph_local` / `graph_traversal` → the same as `text`, plus the `graph_query` tool. `action` → the policy check first (FR-011), then the missing-fields check (FR-009); only then `propose_*` produces a draft.
3. The agent loop (≤ 6 iterations) uses only read tools plus `propose_access_request` / `propose_onboarding_ticket`, which *create draft rows*, not records.
4. The final answer is structured claims → code computes confidence → the response carries the answer, citations, assumptions, gaps, confidence, route, graph path and any `draft`.
5. The UI renders the draft card. **Submit** → `POST /api/drafts/{id}/confirm` → execute the write tool once (unique `draft_id`) → audit `confirmed` + `executed` → emit `access_request.submitted` → start the workflow.

## Complexity Tracking

No unjustified constitution violations. Both issues raised in the first draft of this plan are resolved:

| Item | Resolution |
|---|---|
| "Temperature 0" in FR-020/FR-021 (current models reject sampling parameters) | Approved 2026-11-13: fixed model IDs + fixed effort + strict schemas, no sampling parameters, plus the 3-run variation report. Spec, `evaluation/README.md`, PRD and CLAUDE.md amended (R-03) |
| Cost NFR at risk with Opus everywhere | Model tiering, ADR-010: Haiku router, Sonnet agent, Opus judge. Estimated ≈ $0.006–0.015 per request (R-02); measured at M5 |
