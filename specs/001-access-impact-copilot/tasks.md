# Tasks: Access Impact Copilot

**Input**: `specs/001-access-impact-copilot/`: plan.md (ADR-001–010), spec.md (US1–US6, FR-001–FR-026), research.md (R-01–R-13), data-model.md, contracts/, quickstart.md
**Organisation**: Phases follow the weekend milestones (PRD §10.1). Inside each milestone, tasks are grouped by user story.
**Tests**: Requested. Safety-critical gates (FR-010 confirmation, FR-024a hook guard, draft idempotency) are written **test-first** and must fail before implementation.
**Sizing**: each task ≈ 30–60 min. **[P]** = different files, no dependency on an unfinished task. Tags: `[USn]` story label (story phases only) followed by FR/SC/ADR IDs.
**Priority**: **P1** = required for the hero demo (PRD §5 steps 1–7). **P2** = important but deferrable. **P3** = Sunday or post-launch (FR-026 onboarding, FR-025 Bedrock switch, eval dashboard, baseline toggle, name redaction, launch copy).

**Rules for every task (CLAUDE.md, Constitution III)**
- After each task, run `pnpm eval:fast` on the current milestone's cases (from M2) and put the result in the commit message.
- Don't start the next task while a previously passing golden case fails.
- Never edit `data/raw/`, `data/graph_seed/` or `evaluation/golden_set.jsonl` without asking. Run `python scripts/validate_seed.py` after any fixture change.
- Scripts load secrets with `dotenv` from `.env.local`. Scenario "today" = 2026-11-13.

---

## Phase 1: Setup (M1 tail, Sat ≤ 10:30)

- [ ] T001 **P1** Scaffold Next.js 15 App Router + TypeScript (strict) with pnpm, Node 22 engines field, `app/` and `lib/` folders per plan.md in `package.json`, `tsconfig.json`, `next.config.ts` — ADR-001
- [ ] T002 [P] **P1** Add dependencies pinned with a committed lockfile: `@anthropic-ai/sdk`, `@anthropic-ai/bedrock-sdk`, `@modelcontextprotocol/sdk`, `zod`, `@neondatabase/serverless`, `voyageai`, `langfuse`, `gray-matter`, `dotenv`, `vitest`, `tsx` in `package.json` — ADR-001–ADR-007, ADR-010, PRD §8.1 LLM03
- [ ] T003 [P] **P1** Configure Vitest (unit + integration projects, `tests/` roots) and ESLint/Prettier in `vitest.config.ts`, `eslint.config.mjs` — Constitution III
- [ ] T004 [P] **P1** Create typed env loader: Zod-validated config for `MODEL_PROVIDER`, `ROUTER_MODEL`, `ANTHROPIC_MODEL`, `JUDGE_MODEL`, `BEDROCK_*`, `EMBEDDING_*`, `VOYAGE_API_KEY`, `DATABASE_URL`, `LANGFUSE_*`, `APPROVAL_ENGINE`, `SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY`, demo caps; scripts call `dotenv.config({ path: '.env.local' })` in `lib/config.ts` and `scripts/_env.ts` — FR-025, ADR-007, ADR-010, Constitution V
- [ ] T005 [P] **P1** Add package scripts `dev`, `build`, `test`, `db:migrate`, `ingest`, `eval:fast`, `eval:model`, `eval:full`, `validate` (wraps `python scripts/validate_seed.py`) in `package.json`; list them in the CLAUDE.md Commands section — FR-018–FR-022

## Phase 2: Foundational (blocks every milestone)

- [ ] T006 **P1** Write SQL migration 001 for knowledge tables: `documents` (doc_id PK, title, doc_type, version, owner, source_system, effective_date date null, is_authoritative bool = `doc_type <> 'meeting'`, content_hash), `chunks` (doc_id FK, section, text, `tsv` tsvector GIN, `embedding vector(1024)` HNSW cosine, embedding_model), `nodes`, `edges` with the indexes in data-model.md, in `lib/db/migrations/001_knowledge.sql` — FR-001, FR-002, ADR-002
- [ ] T007 **P1** Write migration runner (ordered `*.sql`, `schema_migrations` table) and Neon client wrapper in `scripts/migrate.ts` and `lib/db/client.ts` — ADR-002
- [ ] T008 [P] **P1** Implement model provider interface `createClient(role: 'router'|'agent'|'judge')` returning an Anthropic client with the role's model ID and explicit effort (router `low`, agent `medium`, judge `medium`); no sampling params (R-01, R-03) in `lib/model/index.ts`, `lib/model/anthropic.ts`, with unit tests for role → model ID/effort mapping, `MODEL_PROVIDER` selection and "no sampling params sent" in `tests/unit/model-provider.test.ts` — FR-025, ADR-010
- [ ] T009 [P] **P1** Implement PII redaction (regex: email, AU/intl phone, ID-like `\b[A-Z]{2,5}-?\d{4,}\b` with `AR-`/`TKT-`/doc-ID allow-list, 13–19-digit card-like numbers) in `lib/observability/redact.ts` with unit tests in `tests/unit/redact.test.ts` — FR-017 (Must)

---

## Phase 3: M2 Retrieval + Tier-1a eval runner (Sat 13:00) · US1 🎯 MVP

**Goal**: ingest the corpus, get hybrid search working, and have the Tier-1a runner gate recall@5, all before any UI.
**Independent test**: `pnpm eval:fast --cases GS-001..GS-008,GS-018..GS-020` gives recall@5 ≥ 90% and exit code 0.

### Minimal ingestion and hybrid search
- [ ] T010 [US1] **P1** Implement document ingest: parse front matter with gray-matter, chunk by `##`/`###` headings keeping `section` as a heading path (e.g. `3. Requirements > 3.4`), upsert `documents` + `chunks` with content_hash in `lib/retrieval/ingest.ts` — FR-001
- [ ] T011 [P] [US1] **P1** Implement embeddings: Voyage `voyage-3.5` 1024-d (`input_type` document|query), Titan V2 1024-d when `EMBEDDING_PROVIDER=bedrock`; fail ingest if stored `embedding_model` ≠ configured; on-disk query cache in `evaluation/cache/` in `lib/retrieval/embed.ts` — ADR-007, R-08
- [ ] T012 [US1] **P1** Wire `scripts/ingest.ts` (documents → chunks → embeddings; idempotent re-run) — FR-001
- [ ] T013 [US1] **P1** Implement hybrid search: `websearch_to_tsquery('english')` + `ts_rank_cd` top 20, pgvector cosine top 20, RRF k=60, return ranked chunks with doc metadata in `lib/retrieval/hybrid.ts` — FR-004, R-07
- [ ] T014 [P] [US1] **P1** Unit-test the recall@5 metric: top 5 **distinct** doc IDs from the ranked list, plus every returned edge `source_doc` on graph routes, score = found ÷ min(5, |expected|), empty `expected_sources` skipped in `evaluation/runner/metrics/recall.ts` and `tests/unit/recall.test.ts` — SC-010, clarification 1

### Tier-1a eval runner (immediately after search)
- [ ] T015 [US1] **P1** Build eval runner CLI: load golden set, `--cases GS-001..GS-008,GS-018..GS-020` ranges, `--category`, `--mode baseline|graphrag|both`, `--runs`, dotenv `.env.local` in `evaluation/runner/cli.ts` — FR-018, FR-022
- [ ] T016 [US1] **P1** Implement Tier 1a: run `validate_seed.py`, call `lib/retrieval` directly (no chat model), compute recall@5 per case and mode in `evaluation/runner/tier1a.ts` — FR-020, FR-021
- [ ] T017 [US1] **P1** Write results + gates: `evaluation/results/<ts>-1a-<mode>.jsonl` (records date, models, embedding model, dataset hash), `summary.md`, milestone thresholds from spec §6, non-zero exit on gate failure, regression guard against `evaluation/results/last-pass.json` in `evaluation/runner/report.ts` — FR-018, Constitution III/VIII
- [ ] T018 [US1] **P1** Run `pnpm eval:fast` on the M2 cases; if recall@5 < 90%, tune chunking/k/RRF (not the fixture) until it passes; commit `last-pass.json` — SC-010 **(M2 gate)**

### Answering (still no UI)
- [ ] T019 [P] [US1] **P1** Define answer and router Zod schemas exactly as contracts/answer-schema.md (behaviour enum `answer|state_gap|clarify|refuse|draft`, claims with `key`, `citations` doc§|edge, `source_status` `effective_policy|proposal_or_meeting`) in `lib/agent/schemas.ts` — FR-006
- [ ] T020 [P] [US1] **P1** Implement confidence rule + citation filtering (drop citations not retrieved this turn; low/medium/high per contract) with unit tests first in `tests/unit/confidence.test.ts`, then `lib/agent/answer.ts` — FR-006, clarification 3
- [ ] T021 [US1] **P1** Implement `text` route answerer: hybrid search → Sonnet structured output → post-process → sanitised Markdown; `state_gap` when nothing passes; prefer effective-dated docs over `MTG-*` in `lib/agent/text-route.ts` and `lib/agent/prompts/answer.md` — FR-004, FR-007, FR-008
- [ ] T022 [US1] **P2** Add a manual smoke script for GS-001, GS-017, GS-019 printing answer + confidence (calls the chat model, so it is not part of Tier 1a; not gated) in `evaluation/runner/smoke.ts` — US1

---

## Phase 4: M3 Graph + router + first chat UI (Sat 17:00) · US1, US2, US6

**Goal**: graph traversal, router and a minimal chat UI live. Route accuracy is gated, and the first baseline vs graphrag comparison is recorded.
**Independent test**: `pnpm eval:fast --cases GS-009..GS-016,GS-021` (GS-009 path matches the seed README), then `pnpm eval:model`, which needs route accuracy ≥ 85% on all 30 cases. GS-001 and GS-009 answer in the browser.

- [ ] T023 [US2] **P1** Implement graph loader from `nodes.csv`/`edges.csv` keeping `source_doc` and `condition`; validate `relation` ∈ the 15 relations in `data/graph_seed/README.md` in `lib/graph/load.ts` (called by `scripts/ingest.ts`) — FR-002
- [ ] T024 [US2] **P1** Integration test first: `graph_query` node mode from `SYS-CRM` reproduces the GS-009 hero traversal edges (incl. `APR-DO` → data owner resolved via `data_owner`) in `tests/integration/graph-hero.test.ts` — FR-005b
- [ ] T025 [US2] **P1** Implement `graph_query` three seed modes as parameterised recursive CTEs (node+`max_hops` ≤ 4 default 2 with relation allow-list; label with `classification`/`condition`; relation with limit), every edge returns `source_doc` in `lib/graph/query.ts` — FR-005b, ADR-005
- [ ] T026 [P] [US2] **P1** Implement condition parser (`key=value[|value]`) and system highest-classification helper in `lib/graph/conditions.ts` with tests in `tests/unit/conditions.test.ts` — FR-002
- [ ] T027 [P] [US2] **P1** Implement REF-005 approval resolver + controls/prerequisites (chain in PRC-012 §3 order, data owner via `data_owner` edge, Ledger Billing finance sign-off) in `lib/policy/approvals.ts` with tests for GS-009/GS-011/GS-015 in `tests/unit/approvals.test.ts` — FR-009
- [ ] T028 [US2] **P1** Unit tests first for router risk labels (every intent; one Restricted, one non-Restricted entity) in `tests/unit/router-risk.test.ts` — FR-003
- [ ] T029 [US2] **P1** Implement router: Haiku structured output (contracts/answer-schema.md router shape), deterministic unsafe pre-rules, code-computed risk, fixed FR-005a intent→route map, refusal → `unsafe` in `lib/router/index.ts`, `lib/router/prompts/router.md` — FR-003, FR-005a, ADR-008
- [ ] T030 [US2] **P1** Implement in-process MCP server + client over in-memory transport; tool registry with `risk` (`read`|`propose`|`write`) and `allowed_roles`; agent client allow-lists `read` + `propose` (unknown risk excluded) in `lib/mcp/server.ts`, `lib/mcp/client.ts` — FR-014, ADR-004
- [ ] T031 [P] [US2] **P1** Register read tools `search_documents`, `get_section`, `graph_query`, `lookup_approvals` per contracts/mcp-tools.md with Zod re-validation in `lib/mcp/tools/read.ts` — FR-014
- [ ] T032 [US2] **P1** Implement agent loop: ≤ 6 iterations, token cap, parallel tool results in one user message, `strict` tools, `stop_reason` refusal handling + `fallbacks: "default"` (Anthropic) in `lib/agent/loop.ts` — ADR-003, R-05, LLM10
- [ ] T033 [US2] **P1** Implement turn orchestrator: redact → router → route (`text` | `graph_local` | `graph_traversal` | `refuse` | `clarify`) → loop → answer; `mode=baseline` disables the graph tool in `lib/agent/turn.ts` — FR-004, FR-005, US6
- [ ] T034 [US1] **P1** Implement `POST /api/chat` (rate limit, daily spend cap, 503 on upstream failure) in `app/api/chat/route.ts` — FR-006, PRD §8.2
- [ ] T035 [US1] **P1** Build chat page with evidence panel (route, confidence, citation chips, graph path, assumptions, gaps, trace link, SIMULATED badge) in `app/page.tsx`, `app/components/EvidencePanel.tsx` — US1, US2
- [ ] T036 [US2] **P2** Implement Tier 1b runner (full turn, fixed models/effort, route accuracy from the turn result, latency, cost; `--runs`) in `evaluation/runner/tier1b.ts` — FR-020, SC-004
- [ ] T037 [US2] **P2** Extend Tier 1a with graph recall (edge `source_doc` counts on graph routes) for GS-009–016, GS-021 in `evaluation/runner/tier1a.ts` — SC-010
- [ ] T038 [US6] **P2** Run `pnpm eval:fast --mode both --category multi_hop` and `pnpm eval:model`; tune router prompt until route accuracy ≥ 85%; record first baseline vs graphrag recall table in `evaluation/results/summary.md` — SC-004, US6 **(M3 gate)**

---

## Phase 5: M4 Agent actions, confirmation gate, approval workflow (Sat 22:00) · US3, US4, US5

**Goal**: drafts → action confirmation → mock write → audit → approval workflow, plus safety and clarify behaviour.
**Independent test**: `pnpm eval:fast --category tool_selection` (confirmation compliance 100%, hook guard) and `pnpm eval:model --cases GS-022..GS-030`.

### Tests first (must fail before implementation)
- [ ] T039 [US3] **P1** Write failing integration test: no execution without confirmation — agent loop on GS-022 never calls a `write` tool; `access_requests` empty; agent tool list contains no `write` tool in `tests/integration/confirmation-gate.test.ts` — FR-010, SC-006
- [ ] T040 [P] [US3] **P1** Write failing integration test: confirm executes exactly once — status `pending_approvals`, audit `proposed`+`confirmed`+`executed`; second confirm returns same `request_id` with `idempotent_replay: true`; concurrent double confirm yields one row (DB unique `draft_id`); superseded/cancelled draft → 409; a draft whose policy check now fails (e.g. vendor assessment expired since drafting) → 409 `policy_check_failed`, audit `blocked`, no execution in `tests/integration/idempotency.test.ts` — FR-010, clarification 4
- [ ] T041 [P] [US3] **P1** Write failing integration test: hook guard — `/api/simulated-approver` rejects calls without `x-approver-panel` or with the agent context marker (403); no MCP tool can resume a hook in `tests/integration/hook-guard.test.ts` — FR-024a, SC-006

### Data, drafts and execution
- [ ] T042 [US3] **P1** Write migration 002 for runtime tables: `drafts` (draft_id uuid PK, lineage_id, version int unique (lineage_id, version), kind `access_request|onboarding_ticket`, payload jsonb, approval_chain, warnings, policy_citations, status `proposed|confirmed|cancelled|superseded`, conversation_id), `access_requests` (`draft_id uuid UNIQUE`, `request_id` `AR-0001` sequence, status `pending_approvals|approved|rejected|expired`), `onboarding_tickets` (`TKT-0001`, `draft_id UNIQUE`), `approval_steps` (unique (request_id, seq), `decided_via` `simulated_approver_panel`), `audit_log` with `REVOKE UPDATE, DELETE` + raising trigger, and a status-transition check trigger in `lib/db/migrations/002_runtime.sql` — FR-010, FR-015
- [ ] T043 [P] [US3] **P1** Implement append-only audit writer (redacts `details`, events per data-model.md, actor labelled unverified) in `lib/audit/audit.ts` — FR-015
- [ ] T044 [P] [US3] **P1** Implement policy checks with unit tests: 90-day contractor PII max + 30-day exception (POL-014 §3.4/§4), contractor admin on Restricted prod not permitted (GS-015), vendor assessment expired or expires before `end_date` (VND-002, today = 2026-11-13) in `lib/policy/checks.ts`, `tests/unit/policy-checks.test.ts` — FR-011, FR-026
- [ ] T045 [P] [US3] **P1** Implement separation-of-duties warning with unit tests (sponsor = data owner → warning; distinct → none; never blocks) in `lib/policy/sod.ts`, `tests/unit/sod.test.ts` — FR-023
- [ ] T046 [US3] **P1** Implement immutable drafts: create (policy check first, then required fields `requester_name, requester_type, sponsor, system_id, access_level, duration_days, justification`; `needs_fields` / `blocked` results), supersede (new version, old → `superseded`), cancel in `lib/drafts/drafts.ts` — FR-009, FR-011, clarifications 2 & 4
- [ ] T047 [US3] **P1** Register `propose_access_request` (`risk: "propose"`) and `check_policy` (`risk: "read"`) in `lib/mcp/tools/propose.ts` — FR-009, FR-014
- [ ] T048 [US3] **P1** Implement idempotent execution + write tool `create_access_request` (`risk: "write"`, require `ConfirmationEvent` in call context, re-run `check_policy` against today's date before executing and refuse with `policy_check_failed` + audit `blocked` if it now fails; insert with `ON CONFLICT (draft_id) DO NOTHING` then read back) in `lib/drafts/execute.ts`, `lib/mcp/tools/write.ts` — FR-010, FR-011, Constitution II
- [ ] T049 [US3] **P1** Implement `POST /api/drafts/[id]/confirm` and `/cancel` per contracts/http-api.md (409 for non-submittable; emits `access_request.submitted`) in `app/api/drafts/[id]/confirm/route.ts`, `app/api/drafts/[id]/cancel/route.ts` — FR-010, FR-024; T039–T040 now pass

### Approval workflow
- [ ] T050 [US3] **P1** Define `ApprovalEngine` interface (`start`, `status`, `resume`) and the in-memory fallback state machine with identical states/events and audit per transition in `lib/workflow/engine.ts`, `lib/workflow/in-memory.ts`, with a unit test that `SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY` scales a 5-business-day SLA to 5 × N seconds and records `sla_breached` when no approver acts in `tests/unit/sla-scale.test.ts` — FR-024, FR-024b
- [ ] T051 [US3] **P2** Verify the Vercel Workflow API against its docs (`"use workflow"`, `"use step"`, hooks, `sleep`, `withWorkflow`), then implement `approvalWorkflow`: hook per approver `${requestId}:${role}` raced against scaled SLA `sleep()`, `sla_breached` escalation, one step per transition writing `approval_steps` + audit, auto-delete for test runs in `lib/workflow/approval.workflow.ts`, `next.config.ts` — FR-024, FR-024b, R-10
- [ ] T052 [US3] **P1** Implement `POST /api/simulated-approver` (panel header + same-origin, rejects agent context, resumes hook via engine) and `GET /api/requests/[id]` timeline in `app/api/simulated-approver/route.ts`, `app/api/requests/[id]/route.ts` — FR-024a; T041 now passes
- [ ] T053 [US3] **P1** **TIME-BOX CHECKPOINT — Sat 22:00**: if the Vercel Workflow path (T051) does not pass T041 and a full sponsor→privacy run with an SLA breach locally, set `APPROVAL_ENGINE=in-memory`, record the decision and reason in `specs/001-access-impact-copilot/research.md` R-10 and the README limitations, and move on. Do not spend more time on it before M5 — ADR-006, PRD §10.1 cut line

### Safety, clarify and M4 gate
- [ ] T054 [P] [US4] **P2** Implement `refuse` route: no tools offered, legitimate path (PRC-012 §7 emergency access; POL-014 export approval), "governance knowledge, not customer data" for record requests in `lib/agent/refuse-route.ts`, `lib/agent/prompts/refuse.md` — FR-012
- [ ] T055 [P] [US5] **P2** Implement `clarify` route: exactly one question covering system/data, requester type, access level (and duration/justification for actions) in `lib/agent/clarify-route.ts`, `lib/agent/prompts/clarify.md` — FR-013
- [ ] T056 [US3] **P1** Wire `action` route into the turn orchestrator: breach reported before missing fields; draft returned in the turn result in `lib/agent/turn.ts` — FR-009, FR-011
- [ ] T057 [US3] **P1** Add Tier-1a confirmation compliance + hook-guard checks (simulated no-confirm run, then Submit; asserts per evaluation/README.md) in `evaluation/runner/tier1a.ts` — SC-006
- [ ] T058 [US3] **P2** Add Tier-1b tool correctness (`expected_tool`/args, names normalised, dates ±3 days, `flag_and_propose` must not contain breaching value), safe behaviour and clarify metrics in `evaluation/runner/metrics/tools.ts`, `evaluation/runner/tier1b.ts` — SC-005, SC-007
- [ ] T059 [US3] **P2** Run M4 evals; fix until tool correctness ≥ 90% (GS-022–025), confirmation compliance 100%, safe behaviour 100% (GS-026–028); update `last-pass.json` — SC-005, SC-006, SC-007 **(M4 gate)**

### Draft card and approver UI
- [ ] T060 [US3] **P1** Build draft approval card (keyboard-operable, SoD warning, prerequisites, policy check, Submit/Cancel; "Submit request" wording) and status timeline in `app/components/DraftCard.tsx`, `app/components/Timeline.tsx` — US3, FR-023, FR-024
- [ ] T061 [P] [US3] **P1** Build Simulated approver panel (one button per role) and audit log page in `app/approver/page.tsx`, `app/audit/page.tsx`, `app/api/audit/route.ts` — FR-024a, FR-015

---

## Phase 6: M5 Judge evals, CI gate, observability (Sun 12:00, feature freeze) · US6

**Goal**: Tier 2 in both modes, CI gates, and Langfuse traces with latency and cost.
**Independent test**: `pnpm eval:full --mode both`, then `pnpm eval:model --runs 3`, with CI green.

- [ ] T062 [P] **P1** Implement Langfuse tracing: trace per turn with intent, risk, route, retrievals, graph edges, tool calls (redacted args), draft IDs, approval decisions (confirmations, cancellations, approver step decisions, `sla_breached`), behaviour, confidence, tokens, cost from a price table, latency; redact before send in `lib/observability/langfuse.ts`, with a unit test using a fake Langfuse client that asserts every required field is present and redaction ran in `tests/unit/trace.test.ts` — FR-016, FR-017, Constitution IV
- [ ] T063 [P] [US6] **P2** Write versioned judge prompts (claims split + support check, citation support, answer-point coverage; strict JSON output) in `evaluation/judges/groundedness.v1.md`, `citation.v1.md`, `completeness.v1.md` — SC-001–SC-003
- [ ] T064 [US6] **P2** Implement Tier 2 runner with `JUDGE_MODEL` (Opus, fixed effort), behaviour-case rule for `state_gap`/`clarify`, both modes in `evaluation/runner/tier2.ts` — FR-020, SC-001–SC-003
- [ ] T065 [US6] **P2** Add 3-run variation report (min/max/mean per Tier-1b metric) and the metric × mode × category table in `evaluation/runner/report.ts` — FR-021, SC-008, SC-009
- [ ] T066 [P] **P1** Add CI: `eval-fast.yml` on every push (validator, tsc, Vitest, Neon branch migrate + ingest, Tier 1a) in `.github/workflows/eval-fast.yml` — FR-019
- [ ] T067 [P] **P2** Add CI: `eval-pr.yml` on PRs to `main` (Tier 1b + Tier 2, secrets, Neon branch create/delete) in `.github/workflows/eval-pr.yml` — FR-019
- [ ] T068 [US6] **P2** Run `eval:full --mode both` and `eval:model --runs 3`; hand-check ≥ 10 cases and log disagreements in `docs/evaluation-results.md` — SC-001–SC-003, Constitution VIII **(M5 gate)**
- [ ] T069 [P] **P3** Implement personal-name redaction (Should; graph `Person` allow-list) in `lib/observability/redact.ts` — FR-017 (cut first if behind)
- [ ] T070 [P] [US6] **P3** Add "Compare with baseline" toggle re-running the turn with `mode=baseline` side by side in `app/components/CompareToggle.tsx` — US6 (Should; cut if behind)

### P3: Sunday or post-launch (only after the M5 gate)
- [ ] T071 [P] **P3** Implement the Bedrock provider with `AnthropicBedrockMantle` (`BEDROCK_ROUTER_MODEL_ID`, `BEDROCK_MODEL_ID`, `awsRegion`), client-side refusal fallback middleware, extend `tests/unit/model-provider.test.ts`, then run `eval:fast` and a Tier-1b subset with `MODEL_PROVIDER=bedrock`; results file records provider and model IDs, in `lib/model/bedrock.ts` — FR-025, R-01
- [ ] T072 [US3] **P3** Add onboarding tickets: `propose_onboarding_ticket` (`risk: "propose"`; fields `contractor_name, vendor?, sponsor, start_date, end_date, restricted_access_expected`; vendor flag when the assessment is expired or expires before `end_date`), `create_onboarding_ticket` (`risk: "write"`, same confirm path, `TKT-0001`), draft card variant, and GS-024 checks in `lib/mcp/tools/propose.ts`, `lib/mcp/tools/write.ts`, `app/components/DraftCard.tsx` — FR-026, GS-024
- [ ] T073 [P] [US6] **P3** Build the eval dashboard page (latest run, metric × mode table, per-category bars, CI link) reading `evaluation/results/summary.md` in `app/evals/page.tsx` — US6 (Could; README table is the fallback)

---

## Phase 7: M6 Deploy and docs (Sun 16:00)

- [ ] T074 **P2** Deploy to Vercel: env vars, Neon production branch, run migrate + ingest, smoke the hero flow (quickstart.md walkthrough) — ADR-001
- [ ] T075 [P] **P2** Write README: one-liner, demo GIF placeholder, live link, problem, architecture diagram, results table (as measured), governance, limitations (incl. any T053 fallback), quickstart, roadmap in `README.md` — PRD §13
- [ ] T076 [P] **P2** Verify fresh clone → running locally in ≤ 10 min following `specs/001-access-impact-copilot/quickstart.md`; fix gaps; run an accessibility pass on the hero flow (keyboard-only, axe check for WCAG 2.2 AA contrast, citations are real links) — PRD §8.2

## Phase 8: M7 Launch (Sun 19:00)

- [ ] T077 **P2** Record ≤ 2-min demo video following PRD §5 steps 2–8; add GIF to `README.md` — PRD §13
- [ ] T078 [P] **P3** Draft LinkedIn post and résumé bullets from measured results in `docs/launch.md` — PRD §13

---

## Execution order (P1 first, in dependency order)

Task IDs follow dependency order, so P1 work is the P1 tasks in ID order. Run P2 tasks only once every P1 task before them is done, and P3 only after the M5 gate.

| Task | Milestone | Work | Est. (min) | Done by (non-stop from Sat 10:30) |
|---|---|---|---|---|
| T001 | Setup | Scaffold Next.js 15 App Router + TypeScript (strict) with pnpm, Node 2 | 45 | Sat 11:15 |
| T002 | Setup | Add dependencies pinned with a committed lockfile: `@anthropic-ai/sdk` | 30 | Sat 11:45 |
| T003 | Setup | Configure Vitest (unit + integration projects, `tests/` roots) and ESL | 30 | Sat 12:15 |
| T004 | Setup | Create typed env loader: Zod-validated config for `MODEL_PROVIDER`, `R | 45 | Sat 13:00 |
| T005 | Setup | Add package scripts `dev`, `build`, `test`, `db:migrate`, `ingest`, `e | 30 | Sat 13:30 |
| T006 | Foundational | Write SQL migration 001 for knowledge tables: `documents` (doc_id PK,  | 45 | Sat 14:15 |
| T007 | Foundational | Write migration runner (ordered `*.sql`, `schema_migrations` table) an | 45 | Sat 15:00 |
| T008 | Foundational | Implement model provider interface `createClient(role: 'router'/'agent | 45 | Sat 15:45 |
| T009 | Foundational | Implement PII redaction (regex: email, AU/intl phone, ID-like `\b[A-Z] | 45 | Sat 16:30 |
| T010 | M2 | Implement document ingest: parse front matter with gray-matter, chunk  | 60 | Sat 17:30 |
| T011 | M2 | Implement embeddings: Voyage `voyage-3.5` 1024-d (`input_type` documen | 45 | Sat 18:15 |
| T012 | M2 | Wire `scripts/ingest.ts` (documents → chunks → embeddings; idempotent  | 30 | Sat 18:45 |
| T013 | M2 | Implement hybrid search: `websearch_to_tsquery('english')` + `ts_rank_ | 60 | Sat 19:45 |
| T014 | M2 | Unit-test the recall@5 metric: top 5 **distinct** doc IDs from the ran | 45 | Sat 20:30 |
| T015 | M2 | Build eval runner CLI: load golden set, `--cases GS-001..GS-008,GS-018 | 45 | Sat 21:15 |
| T016 | M2 | Implement Tier 1a: run `validate_seed.py`, call `lib/retrieval` direct | 45 | Sat 22:00 |
| T017 | M2 | Write results + gates: `evaluation/results/<ts>-1a-<mode>.jsonl` (reco | 60 | Sat 23:00 |
| T018 | M2 | Run `pnpm eval:fast` on the M2 cases; if recall@5 < 90%, tune chunking | 60 | Sun 00:00 |
| T019 | M2 | Define answer and router Zod schemas exactly as contracts/answer-schem | 30 | Sun 00:30 |
| T020 | M2 | Implement confidence rule + citation filtering (drop citations not ret | 45 | Sun 01:15 |
| T021 | M2 | Implement `text` route answerer: hybrid search → Sonnet structured out | 60 | Sun 02:15 |
| T023 | M3 | Implement graph loader from `nodes.csv`/`edges.csv` keeping `source_do | 45 | Sun 03:00 |
| T024 | M3 | Integration test first: `graph_query` node mode from `SYS-CRM` reprodu | 45 | Sun 03:45 |
| T025 | M3 | Implement `graph_query` three seed modes as parameterised recursive CT | 60 | Sun 04:45 |
| T026 | M3 | Implement condition parser (`key=value[/value]`) and system highest-cl | 45 | Sun 05:30 |
| T027 | M3 | Implement REF-005 approval resolver + controls/prerequisites (chain in | 60 | Sun 06:30 |
| T028 | M3 | Unit tests first for router risk labels (every intent; one Restricted, | 30 | Sun 07:00 |
| T029 | M3 | Implement router: Haiku structured output (contracts/answer-schema.md  | 60 | Sun 08:00 |
| T030 | M3 | Implement in-process MCP server + client over in-memory transport; too | 60 | Sun 09:00 |
| T031 | M3 | Register read tools `search_documents`, `get_section`, `graph_query`,  | 45 | Sun 09:45 |
| T032 | M3 | Implement agent loop: ≤ 6 iterations, token cap, parallel tool results | 60 | Sun 10:45 |
| T033 | M3 | Implement turn orchestrator: redact → router → route (`text` / `graph_ | 60 | Sun 11:45 |
| T034 | M3 | Implement `POST /api/chat` (rate limit, daily spend cap, 503 on upstre | 45 | Sun 12:30 |
| T035 | M3 | Build chat page with evidence panel (route, confidence, citation chips | 60 | Sun 13:30 |
| T039 | M4 | Write failing integration test: no execution without confirmation | 45 | Sun 14:15 |
| T040 | M4 | Write failing integration test: confirm executes exactly once | 45 | Sun 15:00 |
| T041 | M4 | Write failing integration test: hook guard | 45 | Sun 15:45 |
| T042 | M4 | Write migration 002 for runtime tables: `drafts` (draft_id uuid PK, li | 60 | Sun 16:45 |
| T043 | M4 | Implement append-only audit writer (redacts `details`, events per data | 30 | Sun 17:15 |
| T044 | M4 | Implement policy checks with unit tests: 90-day contractor PII max + 3 | 60 | Sun 18:15 |
| T045 | M4 | Implement separation-of-duties warning with unit tests (sponsor = data | 30 | Sun 18:45 |
| T046 | M4 | Implement immutable drafts: create (policy check first, then required  | 60 | Sun 19:45 |
| T047 | M4 | Register `propose_access_request` (`risk: "propose"`) and `check_polic | 45 | Sun 20:30 |
| T048 | M4 | Implement idempotent execution + write tool `create_access_request` (` | 60 | Sun 21:30 |
| T049 | M4 | Implement `POST /api/drafts/[id]/confirm` and `/cancel` per contracts/ | 45 | Sun 22:15 |
| T050 | M4 | Define `ApprovalEngine` interface (`start`, `status`, `resume`) and th | 60 | Sun 23:15 |
| T052 | M4 | Implement `POST /api/simulated-approver` (panel header + same-origin,  | 45 | Mon 00:00 |
| T053 | M4 | TIME-BOX CHECKPOINT: Vercel Workflow vs in-memory | 15 | Mon 00:15 |
| T056 | M4 | Wire `action` route into the turn orchestrator: breach reported before | 45 | Mon 01:00 |
| T057 | M4 | Add Tier-1a confirmation compliance + hook-guard checks (simulated no- | 45 | Mon 01:45 |
| T060 | M4 | Build draft approval card (keyboard-operable, SoD warning, prerequisit | 60 | Mon 02:45 |
| T061 | M4 | Build Simulated approver panel (one button per role) and audit log pag | 45 | Mon 03:30 |
| T062 | M5 | Implement Langfuse tracing: trace per turn with intent, risk, route, r | 60 | Mon 04:30 |
| T066 | M5 | Add CI: `eval-fast.yml` on every push (validator, tsc, Vitest, Neon br | 45 | Mon 05:15 |

**P1 total: 54 tasks, ≈ 2565 min ≈ 42.8 h of focused work** (sizes as estimated, before debugging slack). Back to back from 10:30, P1 finishes around **Mon 05:15**, assuming no breaks or sleep.

**Does P1 fit Sat 10:30–22:00 (11.5 h)? No.** P1 needs about 43 h, roughly 3.7× the window. Even if every task took 30 min, P1 would still need ≈ 27 h. Realistic options:
By phase, P1 is Setup + Foundational ≈ 6 h, M2 ≈ 10 h, M3 ≈ 11 h, M4 ≈ 14 h, M5 ≈ 1.75 h. M2 alone fills most of the window. Realistic options:
1. **Agent pace (the most likely way it fits).** These are human-scale estimates. With Claude Code writing the code and you reviewing, tasks of this kind often take ~40% of the human time. That's ≈ 17 h for P1. Sat 10:30–22:00 (11.5 h) + Sun 07:00–12:30 (5.5 h) is just enough, with **zero P2 before the freeze**. The Vercel Workflow decision (T053) stays at Sat 22:00. Expect in-memory by default.
2. **Thinner P1, on top of option 1.** Fold T026 into T025, T043 into T042 and T045 into T046. Build only the in-memory engine (skip T051 entirely). Use one combined chat + draft page. This saves ≈ 3 h of human time (≈ 1.2 h at agent pace) and gives back some slack.
3. **Move the deadline.** If the M2 pace is human-like, P1 needs ≈ 43 h. That doesn't fit the weekend, and the honest move is to publish M2 + M3 (cited lookups + graph answers + evals) on Sunday and ship M4 a week later.

**Decision rule at the M2 gate (Sat 13:00 is not realistic for M2; use whenever T020 passes):** if Setup → M2 took ≤ 6.5 h of clock time (≈ 40% of 16 h), stay on option 1 + 2. If it took more, switch to option 3 and say so in the README.

---

## Dependencies

- Setup → Foundational → M2 → M3 → M4 → M5 → M6 → M7.
- M2: T010 → T012 → T013 → T015 → T016 → T017 → T018. T011 runs alongside T010, and T014 runs alongside T013.
- M3 needs T013 (search) and T017 (runner). T024 comes before T025, T028 before T029, and T030 before T031 and T047. The chat API and page (T034, T035) need T033.
- M4: tests T039–T041 come before T042–T052. T042 comes before T043 and T046–T049. T050 comes before T051 and T052. T053 happens at the time-box whatever state the work is in. The draft card (T060) needs T049 and T035.
- M5 needs the M4 gate (T059). T066 can start right after T017. The P3 tasks need the M5 gate.
- Story completion order: US1 (M2, UI in M3) → US2 (M3) → US3/US4/US5 (M4) → US6 (M5). US4 and US5 depend only on the router (T029).

## Parallel examples

- **M2:** T011 (embeddings) alongside T010 (ingest). T014 (recall metric) alongside T013 (search). T019 and T020 together.
- **M3:** T026, T027 and T031 together, after T025 and T030.
- **M4:** T040 and T041 alongside T039. T043, T044 and T045 together after T042. T054 and T055 together.
- **M5:** T062, T063, T066 and T067 together.

## Implementation strategy

1. **MVP = M2 (US1):** cited lookups, gated by recall@5 in Tier 1a, with no UI. This is the first thing that can be shown working.
2. Each later milestone adds one gated slice: graph, router and chat UI (M3); the governed action plus approvals (M4); judge evals and CI (M5).
3. Cut line, in order: in-memory approvals (T053) → eval dashboard (T073) → baseline toggle (T070) → name redaction (T069). Never cut: the T039–T041 gates, citations, regex redaction (T009), Tier-1a CI (T066).
