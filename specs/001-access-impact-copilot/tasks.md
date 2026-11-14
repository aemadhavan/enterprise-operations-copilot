# Tasks: Access Impact Copilot

**Input**: `specs/001-access-impact-copilot/`: plan.md (ADR-001–010), spec.md (US1–US6, FR-001–FR-026), research.md (R-01–R-13), data-model.md, contracts/, quickstart.md
**Organisation**: Phases follow the weekend milestones (PRD §10.1). Inside each milestone, tasks are grouped by user story.
**Tests**: Requested. Safety-critical gates (FR-010 confirmation, FR-024a hook guard, draft idempotency) are written **test-first** and must fail before implementation.
**Sizing**: each task ≈ 30–60 min. **[P]** = different files, no dependency on an unfinished task. Tags: `[USn]` story label (story phases only) followed by FR/SC/ADR IDs.
**Priority**: **P0** = the **v0.1 weekend slice** (see Execution order). (Every former P1 task is now P0, except the Vercel Workflow checkpoint, which moved to P2.) **P2** = important but deferrable. **P3** = later in v0.2 or post-launch (FR-026 onboarding, FR-025 Bedrock switch, eval dashboard, baseline toggle, name redaction, launch copy).

**Rules for every task (CLAUDE.md, Constitution III)**
- After each task, run `pnpm eval:fast` on the current milestone's cases (from M2) and put the result in the commit message.
- Don't start the next task while a previously passing golden case fails.
- Never edit `data/raw/`, `data/graph_seed/` or `evaluation/golden_set.jsonl` without asking. Run `python scripts/validate_seed.py` after any fixture change.
- Scripts load secrets with `dotenv` from `.env.local`. Scenario "today" = 2026-11-13.

---

## Phase 1: Setup (Sat ≈ 13:00, with Foundational)

- [X] T001 **P0** Scaffold Next.js (current stable from `create-next-app@latest`, 16.x) App Router + TypeScript (strict) with pnpm, Node 22 engines field, `app/` and `lib/` folders per plan.md in `package.json`, `tsconfig.json`, `next.config.ts` — ADR-001
- [X] T002 [P] **P0** Add dependencies pinned with a committed lockfile: `@anthropic-ai/sdk`, `@anthropic-ai/bedrock-sdk`, `@modelcontextprotocol/sdk`, `zod`, `@neondatabase/serverless`, `voyageai`, `langfuse`, `gray-matter`, `dotenv`, `vitest`, `tsx` in `package.json` — ADR-001–ADR-007, ADR-010, PRD §8.1 LLM03
- [X] T003 [P] **P0** Configure Vitest (unit + integration projects, `tests/` roots) and ESLint/Prettier in `vitest.config.ts`, `eslint.config.mjs` — Constitution III
- [X] T004 [P] **P0** Create typed env loader: Zod-validated config for `MODEL_PROVIDER`, `ROUTER_MODEL`, `ANTHROPIC_MODEL`, `JUDGE_MODEL`, `BEDROCK_*`, `EMBEDDING_*`, `VOYAGE_API_KEY`, `DATABASE_URL`, `LANGFUSE_*`, `APPROVAL_ENGINE`, `SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY`, demo caps; scripts call `dotenv.config({ path: '.env.local' })` in `lib/config.ts` and `scripts/_env.ts` — FR-025, ADR-007, ADR-010, Constitution V
- [X] T005 [P] **P0** Add package scripts `dev`, `build`, `test`, `db:migrate`, `ingest`, `eval:fast`, `eval:model`, `eval:full`, `validate` (wraps `python scripts/validate_seed.py`) in `package.json`; list them in the CLAUDE.md Commands section — FR-018–FR-022

## Phase 2: Foundational (Sat ≈ 13:00; blocks every milestone)

- [X] T006 **P0** Write SQL migration 001 for knowledge tables: `documents` (doc_id PK, title, doc_type, version, owner, source_system, effective_date date null, is_authoritative bool = `doc_type <> 'meeting_notes'`, content_hash), `chunks` (doc_id FK, section, text, `tsv` tsvector GIN, `embedding vector(1024)` HNSW cosine, embedding_model), `nodes`, `edges` with the indexes in data-model.md, in `lib/db/migrations/001_knowledge.sql` — FR-001, FR-002, ADR-002
- [X] T007 **P0** Write migration runner (ordered `*.sql`, `schema_migrations` table) and Neon client wrapper in `scripts/migrate.ts` and `lib/db/client.ts` — ADR-002
- [X] T008 [P] **P0** Implement model provider interface `createClient(role: 'router'|'agent'|'judge')` returning an Anthropic client with the role's model ID and explicit effort (router `low`, agent `medium`, judge `medium`); no sampling params (R-01, R-03) in `lib/model/index.ts`, `lib/model/anthropic.ts`, with unit tests for role → model ID/effort mapping, `MODEL_PROVIDER` selection and "no sampling params sent" in `tests/unit/model-provider.test.ts` — FR-025, ADR-010
- [X] T009 [P] **P0** Implement PII redaction (regex: email, AU/intl phone, ID-like `\b[A-Z]{2,5}-?\d{4,}\b` with `AR-`/`TKT-`/doc-ID allow-list, 13–19-digit card-like numbers) in `lib/observability/redact.ts` with unit tests in `tests/unit/redact.test.ts` — FR-017 (Must)

---

## Phase 3: M2 Retrieval + Tier-1a eval runner (Sat ≈ 17:00) · US1 🎯 MVP

**Goal**: ingest the corpus, get hybrid search working, and have the Tier-1a runner gate recall@5, all before any UI.
**Independent test**: `pnpm eval:fast --cases GS-001..GS-008,GS-018..GS-020` gives recall@5 ≥ 90% and exit code 0.

### Minimal ingestion and hybrid search
- [X] T010 [US1] **P0** Implement document ingest: parse front matter with gray-matter, chunk by `##`/`###` headings keeping `section` as a heading path (e.g. `3. Requirements > 3.4`), upsert `documents` + `chunks` with content_hash in `lib/retrieval/ingest.ts` — FR-001
- [X] T011 [P] [US1] **P0** Implement embeddings: Voyage `voyage-3.5` 1024-d (`input_type` document|query), Titan V2 1024-d when `EMBEDDING_PROVIDER=bedrock`; fail ingest if stored `embedding_model` ≠ configured; on-disk query cache in `evaluation/cache/` in `lib/retrieval/embed.ts` — ADR-007, R-08
- [X] T012 [US1] **P0** Wire `scripts/ingest.ts` (documents → chunks → embeddings; idempotent re-run) — FR-001
- [X] T013 [US1] **P0** Implement hybrid search: OR full-text query `to_tsquery('english', replace(plainto_tsquery('english', $q)::text, ' & ', ' | '))` + `ts_rank_cd(tsv, q, 2)` top 20 (changed from `websearch_to_tsquery`, R-07), pgvector cosine top 20, RRF k=60, return ranked chunks with doc metadata in `lib/retrieval/hybrid.ts` — FR-004, R-07
- [X] T014 [P] [US1] **P0** Unit-test the recall@5 metric: top 5 **distinct** doc IDs from the ranked list, plus every returned edge `source_doc` on graph routes, score = found ÷ min(5, |expected|), empty `expected_sources` skipped in `evaluation/runner/metrics/recall.ts` and `tests/unit/recall.test.ts` — SC-010, clarification 1

### Tier-1a eval runner (immediately after search)
- [X] T015 [US1] **P0** Build eval runner CLI: load golden set, `--cases GS-001..GS-008,GS-018..GS-020` ranges, `--category`, `--mode baseline|graphrag|both`, `--runs`, dotenv `.env.local` in `evaluation/runner/cli.ts` — FR-018, FR-022
- [X] T016 [US1] **P0** Implement Tier 1a: run `validate_seed.py`, call `lib/retrieval` directly (no chat model), compute recall@5 per case and mode in `evaluation/runner/tier1a.ts` — FR-020, FR-021
- [X] T017 [US1] **P0** Write results + gates: `evaluation/results/<ts>-1a-<mode>.jsonl` (records date, models, embedding model, dataset hash), `summary.md`, milestone thresholds from spec §6, non-zero exit on gate failure, regression guard against `evaluation/results/last-pass.json` in `evaluation/runner/report.ts` — FR-018, Constitution III/VIII
- [X] T018 [US1] **P0** Run `pnpm eval:fast` on the M2 cases; if recall@5 < 90%, tune chunking/k/RRF (not the fixture) until it passes; commit `last-pass.json` — SC-010 **(M2 gate)**

### Answering (still no UI)
- [X] T019 [P] [US1] **P0** Define answer and router Zod schemas exactly as contracts/answer-schema.md (behaviour enum `answer|state_gap|clarify|refuse|draft`, claims with `key`, `citations` doc§|edge, `source_status` `effective_policy|proposal_or_meeting`) in `lib/agent/schemas.ts` — FR-006
- [X] T020 [P] [US1] **P0** Implement confidence rule + citation filtering (drop citations not retrieved this turn; low/medium/high per contract) with unit tests first in `tests/unit/confidence.test.ts`, then `lib/agent/answer.ts` — FR-006, clarification 3
- [X] T021 [US1] **P0** Implement `text` route answerer: hybrid search → Sonnet structured output → post-process → sanitised Markdown; `state_gap` when nothing passes; prefer effective-dated docs over `MTG-*` in `lib/agent/text-route.ts` and `lib/agent/prompts/answer.md` — FR-004, FR-007, FR-008
- [ ] T022 [US1] **P2** Add a manual smoke script for GS-001, GS-017, GS-019 printing answer + confidence (calls the chat model, so it is not part of Tier 1a; not gated) in `evaluation/runner/smoke.ts` — US1

---

## Phase 4: M3 Graph + router + first chat UI (Sat ≈ 21:15) · US1, US2, US6

**Goal**: graph traversal, router and a minimal chat UI live. Route accuracy is gated, and the first baseline vs graphrag comparison is recorded.
**Independent test**: `pnpm eval:fast --cases GS-009..GS-016,GS-021` (GS-009 path matches the seed README), then `pnpm eval:model` / `pnpm eval:route` for route accuracy on all 30 cases (reported in v0.1, gated at ≥ 85% in v0.2). Only graphrag mode is gated in Tier 1a; baseline is reported. GS-001 and GS-009 answer in the browser.

- [X] T023 [US2] **P0** Implement graph loader from `nodes.csv`/`edges.csv` keeping `source_doc` and `condition`; validate `relation` ∈ the 16 relations (15 + implemented_by, added 2026-11-14) in `data/graph_seed/README.md` in `lib/graph/load.ts` (called by `scripts/ingest.ts`) — FR-002
- [X] T024 [US2] **P0** Integration test first: `graph_query` node mode from `SYS-CRM` reproduces the GS-009 hero traversal edges (incl. `APR-DO` → data owner resolved via `data_owner`) in `tests/integration/graph-hero.test.ts` — FR-005b
- [X] T025 [US2] **P0** Implement `graph_query` three seed modes as parameterised recursive CTEs (node+`max_hops` ≤ 4 default 2 with relation allow-list; label with `classification`/`condition`; relation with limit), every edge returns `source_doc` in `lib/graph/query.ts`; include the condition parser (`key=value[|value]`) and system highest-classification helper in `lib/graph/conditions.ts` with tests in `tests/unit/conditions.test.ts` (merged) — FR-002, FR-005b, ADR-005
- [X] T026 [P] [US2] **P0** Implement REF-005 approval resolver + controls/prerequisites (chain in PRC-012 §3 order, data owner via `data_owner` edge, Ledger Billing finance sign-off) in `lib/policy/approvals.ts` with tests for GS-009/GS-011/GS-015 in `tests/unit/approvals.test.ts` — FR-009
- [X] T027 [US2] **P0** Unit tests first for router risk labels (every intent; one Restricted, one non-Restricted entity) in `tests/unit/router-risk.test.ts` — FR-003
- [X] T028 [US2] **P0** Implement router: Haiku structured output (contracts/answer-schema.md router shape), deterministic unsafe pre-rules, code-computed risk, fixed FR-005a intent→route map, refusal → `unsafe` in `lib/router/index.ts`, `lib/router/prompts/router.md` — FR-003, FR-005a, ADR-008
- [X] T029 [US2] **P0** Implement in-process MCP server + client over in-memory transport; tool registry with `risk` (`read`|`propose`|`write`) and `allowed_roles`; agent client allow-lists `read` + `propose` (unknown risk excluded) in `lib/mcp/server.ts`, `lib/mcp/client.ts` — FR-014, ADR-004
- [X] T030 [P] [US2] **P0** Register read tools `search_documents`, `get_section`, `graph_query`, `lookup_approvals` per contracts/mcp-tools.md with Zod re-validation in `lib/mcp/tools/read.ts` — FR-014
- [X] T031 [US2] **P0** Implement agent loop: ≤ 6 iterations, token cap, parallel tool results in one user message, `strict` tools, `stop_reason` refusal handling + `fallbacks: "default"` (Anthropic) in `lib/agent/loop.ts` — ADR-003, R-05, LLM10
- [X] T032 [US2] **P0** Implement turn orchestrator: redact → router → route (`text` | `graph_local` | `graph_traversal` | `refuse` | `clarify`) → loop → answer; `mode=baseline` disables the graph tool in `lib/agent/turn.ts` — FR-004, FR-005, US6
- [X] T033 [US1] **P0** Implement `POST /api/chat` (rate limit, daily spend cap, 503 on upstream failure) in `app/api/chat/route.ts` — FR-006, PRD §8.2
- [X] T034 [US1] **P0** Build chat page with evidence panel (route, confidence, citation chips, graph path, assumptions, gaps, trace link, SIMULATED badge) in `app/page.tsx`, `app/components/EvidencePanel.tsx` — US1, US2
- [ ] T035 [US2] **P2** Implement Tier 1b runner (full turn, fixed models/effort, route accuracy from the turn result, latency, cost; `--runs`) in `evaluation/runner/tier1b.ts` — FR-020, SC-004
- [X] T036 [US2] **P2** Extend Tier 1a with graph recall (edge `source_doc` counts on graph routes) for GS-009–016, GS-021 in `evaluation/runner/tier1a.ts` — SC-010
- [ ] T037 [US6] **P2** Run `pnpm eval:fast --mode both --category multi_hop` and `pnpm eval:model`; report route accuracy (reported in v0.1, gated at ≥ 85% in v0.2; tune the router prompt if below); record first baseline vs graphrag recall table in `evaluation/results/summary.md` (graphrag gated, baseline reported) — SC-004, US6 **(M3 gate: graphrag recall@5 in v0.1; route accuracy from v0.2)**

---

## Phase 5: M4 Agent actions, confirmation gate, approval workflow (Sun ≈ 12:40, start 07:00) · US3, US4, US5

**Goal**: drafts → action confirmation → mock write → audit → approval workflow, plus safety and clarify behaviour.
**Independent test**: `pnpm eval:fast --category tool_selection` (confirmation compliance 100%, hook guard) and `pnpm eval:model --cases GS-022..GS-030`.

### Tests first (must fail before implementation)
- [X] T038 [US3] **P0** Write failing integration test: no execution without confirmation — agent loop on GS-022 never calls a `write` tool; `access_requests` empty; agent tool list contains no `write` tool in `tests/integration/confirmation-gate.test.ts` — FR-010, SC-006
- [X] T039 [P] [US3] **P0** Write failing integration test: confirm executes exactly once — status `pending_approvals`, audit `proposed`+`confirmed`+`executed`; second confirm returns same `request_id` with `idempotent_replay: true`; concurrent double confirm yields one row (DB unique `draft_id`); superseded/cancelled draft → 409; a draft whose policy check now fails (e.g. vendor assessment expired since drafting) → 409 `policy_check_failed`, audit `blocked`, no execution in `tests/integration/idempotency.test.ts` — FR-010, clarification 4
- [X] T040 [P] [US3] **P0** Write failing integration test: hook guard — `/api/simulated-approver` rejects calls without `x-approver-panel` or with the agent context marker (403); no MCP tool can resume a hook in `tests/integration/hook-guard.test.ts` — FR-024a, SC-006

### Data, drafts and execution
- [X] T041 [US3] **P0** Write migration 002 for runtime tables: `drafts` (draft_id uuid PK, lineage_id, version int unique (lineage_id, version), kind `access_request|onboarding_ticket`, payload jsonb, approval_chain, warnings, policy_citations, status `proposed|confirmed|cancelled|superseded`, conversation_id), `access_requests` (`draft_id uuid UNIQUE`, `request_id` `AR-0001` sequence, status `pending_approvals|approved|rejected|expired`), `onboarding_tickets` (`TKT-0001`, `draft_id UNIQUE`), `approval_steps` (unique (request_id, seq), `decided_via` `simulated_approver_panel`), `audit_log` with `REVOKE UPDATE, DELETE` + raising trigger, and a status-transition check trigger in `lib/db/migrations/002_runtime.sql`; then the append-only audit writer (redacts `details`, events per data-model.md, actor labelled unverified) in `lib/audit/audit.ts` (merged) — FR-010, FR-015
- [X] T042 [P] [US3] **P0** Implement policy checks with unit tests: 90-day contractor PII max + 30-day exception (POL-014 §3.4/§4), contractor admin on Restricted prod not permitted (GS-015), vendor assessment expired or expires before `end_date` (VND-002, today = 2026-11-13) in `lib/policy/checks.ts`, `tests/unit/policy-checks.test.ts` — FR-011, FR-026
- [X] T043 [US3] **P0** Implement immutable drafts: create (policy check first, then required fields `requester_name, requester_type, sponsor, system_id, access_level, duration_days, justification`; `needs_fields` / `blocked` results), supersede (new version, old → `superseded`), cancel in `lib/drafts/drafts.ts`; include the separation-of-duties warning (sponsor = data owner → warning; distinct → none; never blocks) in `lib/policy/sod.ts` with `tests/unit/sod.test.ts` (merged) — FR-009, FR-011, FR-023, clarifications 2 & 4
- [X] T044 [US3] **P0** Register `propose_access_request` (`risk: "propose"`) and `check_policy` (`risk: "read"`) in `lib/mcp/tools/propose.ts` — FR-009, FR-014
- [X] T045 [US3] **P0** Implement idempotent execution + write tool `create_access_request` (`risk: "write"`, require `ConfirmationEvent` in call context, re-run `check_policy` against today's date before executing and refuse with `policy_check_failed` + audit `blocked` if it now fails; insert with `ON CONFLICT (draft_id) DO NOTHING` then read back) in `lib/drafts/execute.ts`, `lib/mcp/tools/write.ts` — FR-010, FR-011, Constitution II
- [X] T046 [US3] **P0** Implement `POST /api/drafts/[id]/confirm` and `/cancel` per contracts/http-api.md (409 for non-submittable; emits `access_request.submitted`) in `app/api/drafts/[id]/confirm/route.ts`, `app/api/drafts/[id]/cancel/route.ts` — FR-010, FR-024; T038–T039 now pass

### Approval workflow
- [X] T047 [US3] **P0** Define `ApprovalEngine` interface (`start`, `status`, `resume`) and the in-memory state machine (the only engine in v0.1) with identical states/events and audit per transition in `lib/workflow/engine.ts`, `lib/workflow/in-memory.ts`, with a unit test that `SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY` scales a 5-business-day SLA to 5 × N seconds and records `sla_breached` when no approver acts in `tests/unit/sla-scale.test.ts` — FR-024, FR-024b
- [ ] T048 [US3] **P2** Verify the Vercel Workflow API against its docs (`"use workflow"`, `"use step"`, hooks, `sleep`, `withWorkflow`), then implement `approvalWorkflow`: hook per approver `${requestId}:${role}` raced against scaled SLA `sleep()`, `sla_breached` escalation, one step per transition writing `approval_steps` + audit, auto-delete for test runs in `lib/workflow/approval.workflow.ts`, `next.config.ts` — FR-024, FR-024b, R-10
- [X] T049 [US3] **P0** Implement `POST /api/simulated-approver` (panel header + same-origin, rejects agent context, resumes hook via engine) and `GET /api/requests/[id]` timeline in `app/api/simulated-approver/route.ts`, `app/api/requests/[id]/route.ts` — FR-024a; T040 now passes
- [ ] T050 [US3] **P2** **TIME-BOX CHECKPOINT (v0.2)**: v0.1 ships the in-memory engine. When v0.2 starts the Vercel Workflow (T048), time-box it to one evening; if it does not pass T040 and a full sponsor→privacy run with an SLA breach locally, keep `APPROVAL_ENGINE=in-memory` and record the decision in research.md R-10 and the README limitations — ADR-006, PRD §10.1 cut line

### Safety, clarify and M4 gate
- [X] T051 [P] [US4] **P0** Implement `refuse` route: no tools offered, legitimate path (PRC-012 §7 emergency access; POL-014 export approval), "governance knowledge, not customer data" for record requests in `lib/agent/refuse-route.ts`, `lib/agent/prompts/refuse.md` — FR-012
- [ ] T052 [P] [US5] **P2** Implement `clarify` route: exactly one question covering system/data, requester type, access level (and duration/justification for actions) in `lib/agent/clarify-route.ts`, `lib/agent/prompts/clarify.md` — FR-013
- [X] T053 [US3] **P0** Wire `action` route into the turn orchestrator: breach reported before missing fields; draft returned in the turn result in `lib/agent/turn.ts` — FR-009, FR-011
- [X] T054 [US3] **P0** Add Tier-1a confirmation compliance + hook-guard checks (simulated no-confirm run, then Submit; asserts per evaluation/README.md) in `evaluation/runner/tier1a.ts` — SC-006
- [ ] T055 [US3] **P2** Add Tier-1b tool correctness (`expected_tool`/args, names normalised, dates ±3 days, `flag_and_propose` must not contain breaching value), safe behaviour and clarify metrics in `evaluation/runner/metrics/tools.ts`, `evaluation/runner/tier1b.ts` — SC-005, SC-007
- [ ] T056 [US3] **P2** Run M4 evals; fix until tool correctness ≥ 90% (GS-022–025), confirmation compliance 100%, safe behaviour 100% (GS-026–028); update `last-pass.json` — SC-005, SC-006, SC-007 **(M4 gate)**

### Draft card and approver UI
- [X] T057 [US3] **P0** Build draft approval card (keyboard-operable, SoD warning, prerequisites, policy check, Submit/Cancel; "Submit request" wording) and status timeline in `app/components/DraftCard.tsx`, `app/components/Timeline.tsx` — US3, FR-023, FR-024
- [X] T058 [P] [US3] **P0** Build Simulated approver panel (one button per role) and audit log page in `app/approver/page.tsx`, `app/audit/page.tsx`, `app/api/audit/route.ts` — FR-024a, FR-015

---

## Phase 6: M5 Judge evals, CI gate, observability (Sun ≈ 14:00 with M6, feature freeze; judge evals are v0.2) · US6

**Goal**: Tier 2 in both modes, CI gates, and Langfuse traces with latency and cost.
**Independent test**: `pnpm eval:full --mode both`, then `pnpm eval:model --runs 3`, with CI green.

- [X] T059 [P] **P0** Implement Langfuse tracing (v0.1 needs at least route, retrievals, tool calls, approval decisions, tokens, cost, latency; Constitution IV): trace per turn with intent, risk, route, retrievals, graph edges, tool calls (redacted args), draft IDs, approval decisions (confirmations, cancellations, approver step decisions, `sla_breached`), behaviour, confidence, tokens, cost from a price table, latency; redact before send in `lib/observability/langfuse.ts`, with a unit test using a fake Langfuse client that asserts every required field is present and redaction ran in `tests/unit/trace.test.ts` — FR-016, FR-017, Constitution IV
- [ ] T060 [P] [US6] **P2** Write versioned judge prompts (claims split + support check, citation support, answer-point coverage; strict JSON output) in `evaluation/judges/groundedness.v1.md`, `citation.v1.md`, `completeness.v1.md` — SC-001–SC-003
- [ ] T061 [US6] **P2** Implement Tier 2 runner with `JUDGE_MODEL` (Opus, fixed effort), behaviour-case rule for `state_gap`/`clarify`, both modes in `evaluation/runner/tier2.ts` — FR-020, SC-001–SC-003
- [ ] T062 [US6] **P2** Add 3-run variation report (min/max/mean per Tier-1b metric) and the metric × mode × category table in `evaluation/runner/report.ts` — FR-021, SC-008, SC-009
- [X] T063 [P] **P0** Add CI: `eval-fast.yml` on every push (validator, tsc, Vitest, Neon branch migrate + ingest, Tier 1a) in `.github/workflows/eval-fast.yml` — FR-019
- [ ] T064 [P] **P2** Add CI: `eval-pr.yml` on PRs to `main` (Tier 1b + Tier 2, secrets, Neon branch create/delete) in `.github/workflows/eval-pr.yml` — FR-019
- [ ] T065 [US6] **P2** Run `eval:full --mode both` and `eval:model --runs 3`; hand-check ≥ 10 cases and log disagreements in `docs/evaluation-results.md` — SC-001–SC-003, Constitution VIII **(M5 gate)**
- [ ] T066 [P] **P3** Implement personal-name redaction (Should; graph `Person` allow-list) in `lib/observability/redact.ts` — FR-017 (cut first if behind)
- [ ] T067 [P] [US6] **P3** Add "Compare with baseline" toggle re-running the turn with `mode=baseline` side by side in `app/components/CompareToggle.tsx` — US6 (Should; cut if behind)

### P3: v0.2 or post-launch
- [ ] T068 [P] **P3** Implement the Bedrock provider with `AnthropicBedrockMantle` (`BEDROCK_ROUTER_MODEL_ID`, `BEDROCK_MODEL_ID`, `awsRegion`), client-side refusal fallback middleware, extend `tests/unit/model-provider.test.ts`, then run `eval:fast` and a Tier-1b subset with `MODEL_PROVIDER=bedrock`; results file records provider and model IDs, in `lib/model/bedrock.ts` — FR-025, R-01
- [ ] T069 [US3] **P3** Add onboarding tickets: `propose_onboarding_ticket` (`risk: "propose"`; fields `contractor_name, vendor?, sponsor, start_date, end_date, restricted_access_expected`; vendor flag when the assessment is expired or expires before `end_date`), `create_onboarding_ticket` (`risk: "write"`, same confirm path, `TKT-0001`), draft card variant, and GS-024 checks in `lib/mcp/tools/propose.ts`, `lib/mcp/tools/write.ts`, `app/components/DraftCard.tsx` — FR-026, GS-024
- [ ] T070 [P] [US6] **P3** Build the eval dashboard page (latest run, metric × mode table, per-category bars, CI link) reading `evaluation/results/summary.md` in `app/evals/page.tsx` — US6 (Could; README table is the fallback)

---

## Phase 7: M6 Deploy and docs (Sun ≈ 14:00, feature freeze)

- [X] T071 **P0** Deploy to Vercel: env vars, Neon production branch, run migrate + ingest, smoke the hero flow (quickstart.md walkthrough) — ADR-001
- [X] T072 [P] **P0** Write README: one-liner, demo GIF placeholder, live link, problem, architecture diagram, results table (as measured; Tier 1a only in v0.1, Tier 1b/2 marked "v0.2"), governance, limitations (incl. any T050 fallback), quickstart, roadmap in `README.md` — PRD §13
- [ ] T073 [P] **P2** Verify fresh clone → running locally in ≤ 10 min following `specs/001-access-impact-copilot/quickstart.md`; fix gaps; run an accessibility pass on the hero flow (keyboard-only, axe check for WCAG 2.2 AA contrast, citations are real links) — PRD §8.2

## Phase 8: M7 Launch (Sun 19:00)

- [ ] T074 **P2** Record ≤ 2-min demo video following PRD §5 steps 2–8; add GIF to `README.md` — PRD §13
- [ ] T075 [P] **P3** Draft LinkedIn post and résumé bullets from measured results in `docs/launch.md` — PRD §13

---

## Execution order: v0.1 weekend slice (P0)

**Scope.** M2 complete. M3 graph, router, answer schema and one chat page. M4 core only: `check_policy`, `propose_access_request`, the draft card, confirm with idempotency and a policy re-check, the audit log, the three test-first safety tests (T038 confirmation gate, T039 idempotency, T040 hook guard), and the in-memory approval timeline. Tier-1a CI, Vercel deploy and README. **Everything else is v0.2** (PRD §10.2).

**Added to P0 because the constitution requires it** (not in the original slice list):
- T051 refuse route. Constitution II: MUST NOT help bypass approvals.
- T059 a minimal Langfuse trace. Constitution IV: every request is traced.
- T054 Tier-1a confirmation-compliance check. Constitution III: the gate is tested in CI.

**Merged** to cut overhead: the condition parser into T025, the audit writer into T041, the SoD warning into T043.

Run in ID order (IDs follow dependency order), skipping anything not tagged P0.

| Block | Tasks | # | Human pace | ≈ 40% agent pace |
|---|---|---|---|---|
| Setup + Foundational | T001, T002, T003, T004, T005, T006, T007, T008, T009 | 9 | 6.0 h | 2.4 h |
| M2 (complete) | T010, T011, T012, T013, T014, T015, T016, T017, T018, T019, T020, T021 | 12 | 9.8 h | 3.9 h |
| M3: graph, router, answer schema, one chat page | T023, T024, T025, T026, T027, T028, T029, T030, T031, T032, T033, T034 | 12 | 11.0 h | 4.4 h |
| M4 core: safety tests, drafts, confirm, audit, in-memory timeline | T038, T039, T040, T041, T042, T043, T044, T045, T046, T047, T049, T051, T053, T054, T057, T058 | 16 | 14.0 h | 5.6 h |
| Tracing, Tier-1a CI, deploy, README | T059, T063, T071, T072 | 4 | 3.8 h | 1.5 h |
| **Total P0** | | **53** | **44.5 h** | **17.8 h** |

**Does it fit?**
- **Saturday 10:30–22:00 (11.5 h):** no, at either pace. At agent pace, Saturday gets through Setup → M3 (≈ 10.7 h).
- **The whole weekend** (Sat 10:30–22:00 + Sun 07:00–19:00 ≈ 23.5 h): **yes at agent pace** (17.8 h, leaving ≈ 5.7 h for debugging, the demo video and breaks). **No at human pace** (44 h).
- Sunday at agent pace: M4 core (≈ 5.6 h) from 07:00 to about 12:40, then tracing, CI, deploy and README (≈ 1.5 h) by about 14:10. That leaves the afternoon for debugging and the 19:00 launch.

**Decision rule:** when T018 (the M2 gate) passes, compare the clock with the estimate. Setup → M2 should take ≈ 6.3 h at agent pace. If it took more than 1.5× that, cut v0.1 to M2 + M3 (cited lookups and graph answers with Tier-1a CI). Ship the drafts and confirmation flow in v0.2, and say so in the README.

---

## Dependencies

- Setup → Foundational → M2 → M3 → M4 → M5 → M6 → M7. In v0.1, deploy and README (T071, T072) come right after the P0 part of M5 (T059, T063).
- M2: T010 → T012 → T013 → T015 → T016 → T017 → T018. T011 runs alongside T010, and T014 runs alongside T013.
- M3 needs T013 (search) and T017 (runner). T024 comes before T025, T027 before T028, and T029 before T030 and T044. The chat API and page (T033, T034) need T032.
- M4: tests T038–T040 come before T041–T049. T041 comes before T043–T046. T042 comes before T043. T047 comes before T049. The hook-guard test (T040) passes once T049 exists. The draft card (T057) needs T046 and T034. T053 needs T043 and T032.
- v0.2: T048 needs T047. T050 time-boxes T048. M5 judge work (T060–T062, T065) needs T035. T063 can start right after T017.
- Story completion order: US1 (M2, UI in M3) → US2 (M3) → US3 + US4 (M4 core, v0.1) → US5, US6 (v0.2). US4 and US5 depend only on the router (T028).

## Parallel examples

- **M2:** T011 (embeddings) alongside T010 (ingest). T014 (recall metric) alongside T013 (search). T019 and T020 together.
- **M3:** T026 (approval resolver) and T030 (read tools) together, after T025 and T029.
- **M4:** T039 and T040 alongside T038. T042 (policy checks) alongside T041 (migration + audit writer). T051 (refuse) alongside T053 (action route).
- **v0.1 tail:** T059 (tracing), T063 (CI) and T072 (README) together.

## Implementation strategy

1. **MVP = M2 (US1):** cited lookups, gated by recall@5 in Tier 1a, with no UI. This is the first thing that can be shown working.
2. **v0.1 (P0 weekend slice):** M2, then graph, router and one chat page, then the governed draft → confirm → audit → in-memory timeline, then Tier-1a CI, deploy and README.
3. **v0.2:** Tier 1b and Tier 2 gates, Vercel Workflow, clarify, onboarding, Bedrock, baseline toggle, eval dashboard, name redaction, demo video (PRD §10.2).
4. Never cut from v0.1: the T038–T040 gates, citations, regex redaction (T009), refusals (T051), tracing (T059), Tier-1a CI (T063).
