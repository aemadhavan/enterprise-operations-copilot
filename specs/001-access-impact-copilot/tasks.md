# Tasks: Access Impact Copilot

**Input**: `specs/001-access-impact-copilot/` — plan.md (ADR-001–010), spec.md (US1–US6, FR-001–FR-026), research.md (R-01–R-13), data-model.md, contracts/, quickstart.md
**Organisation**: Phases follow the weekend milestones (PRD §10.1). Inside each milestone, tasks are grouped by user story.
**Tests**: Requested. Safety-critical gates (FR-010 confirmation, FR-024a hook guard, draft idempotency) are written **test-first** and must fail before implementation.
**Sizing**: each task ≈ 30–60 min. **[P]** = different files, no dependency on an unfinished task. Tags: `[USn]` story label (story phases only) followed by FR/SC IDs.

**Rules for every task (CLAUDE.md, Constitution III)**
- After each task: run `pnpm eval:fast` on the current milestone's cases (from M2) and put the result in the commit message.
- Don't start the next task while a previously passing golden case fails.
- Never edit `data/raw/`, `data/graph_seed/` or `evaluation/golden_set.jsonl` without asking; run `python scripts/validate_seed.py` after any fixture change.
- Scripts load secrets with `dotenv` from `.env.local`. Scenario "today" = 2026-11-13.

---

## Phase 1: Setup (M1 tail, Sat ≤ 10:30)

- [ ] T001 Scaffold Next.js 15 App Router + TypeScript (strict) with pnpm, Node 22 engines field, `app/` and `lib/` folders per plan.md in `package.json`, `tsconfig.json`, `next.config.ts`
- [ ] T002 [P] Add dependencies pinned with a committed lockfile: `@anthropic-ai/sdk`, `@anthropic-ai/bedrock-sdk`, `@modelcontextprotocol/sdk`, `zod`, `@neondatabase/serverless`, `voyageai`, `langfuse`, `gray-matter`, `dotenv`, `vitest`, `tsx` in `package.json`
- [ ] T003 [P] Configure Vitest (unit + integration projects, `tests/` roots) and ESLint/Prettier in `vitest.config.ts`, `eslint.config.mjs`
- [ ] T004 [P] Create typed env loader: Zod-validated config for `MODEL_PROVIDER`, `ROUTER_MODEL`, `ANTHROPIC_MODEL`, `JUDGE_MODEL`, `BEDROCK_*`, `EMBEDDING_*`, `VOYAGE_API_KEY`, `DATABASE_URL`, `LANGFUSE_*`, `APPROVAL_ENGINE`, `SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY`, demo caps; scripts call `dotenv.config({ path: '.env.local' })` in `lib/config.ts` and `scripts/_env.ts`
- [ ] T005 [P] Add package scripts `dev`, `build`, `test`, `db:migrate`, `ingest`, `eval:fast`, `eval:model`, `eval:full`, `validate` (wraps `python scripts/validate_seed.py`) in `package.json`; list them in the CLAUDE.md Commands section

## Phase 2: Foundational (blocks every milestone, Sat ≤ 11:15)

- [ ] T006 Write SQL migration 001 for knowledge tables: `documents` (doc_id PK, title, doc_type, version, owner, source_system, effective_date date null, is_authoritative bool = `doc_type <> 'meeting'`, content_hash), `chunks` (doc_id FK, section, text, `tsv` tsvector GIN, `embedding vector(1024)` HNSW cosine, embedding_model), `nodes`, `edges` with the indexes in data-model.md, in `lib/db/migrations/001_knowledge.sql`
- [ ] T007 Write migration runner (ordered `*.sql`, `schema_migrations` table) and Neon client wrapper in `scripts/migrate.ts` and `lib/db/client.ts`
- [ ] T008 [P] Implement model provider interface `createClient(role: 'router'|'agent'|'judge')` returning Anthropic or `AnthropicBedrockMantle` clients with the role's model ID and explicit effort (router `low`, agent `medium`, judge `medium`); no sampling params (R-01, R-03) in `lib/model/index.ts`, `lib/model/anthropic.ts`, `lib/model/bedrock.ts` — FR-025
- [ ] T009 [P] Implement PII redaction (regex: email, AU/intl phone, ID-like `\b[A-Z]{2,5}-?\d{4,}\b` with `AR-`/`TKT-`/doc-ID allow-list, 13–19-digit card-like numbers) in `lib/observability/redact.ts` with unit tests in `tests/unit/redact.test.ts` — FR-017 (Must)

---

## Phase 3: M2 — Retrieval + Tier-1a eval runner (Sat 13:00) · US1 🎯 MVP

**Goal**: ingest the corpus, hybrid search works, and the Tier-1a runner gates recall@5 — before any UI.
**Independent test**: `pnpm eval:fast --cases GS-001..GS-008,GS-018..GS-020` → recall@5 ≥ 90%, exit 0.

### Minimal ingestion and hybrid search
- [ ] T010 [US1] Implement document ingest: parse front matter with gray-matter, chunk by `##`/`###` headings keeping `section` as a heading path (e.g. `3. Requirements > 3.4`), upsert `documents` + `chunks` with content_hash in `lib/retrieval/ingest.ts` — FR-001
- [ ] T011 [P] [US1] Implement embeddings: Voyage `voyage-3.5` 1024-d (`input_type` document|query), Titan V2 1024-d when `EMBEDDING_PROVIDER=bedrock`; fail ingest if stored `embedding_model` ≠ configured; on-disk query cache in `evaluation/cache/` in `lib/retrieval/embed.ts` — ADR-007, R-08
- [ ] T012 [US1] Wire `scripts/ingest.ts` (documents → chunks → embeddings; idempotent re-run) — FR-001
- [ ] T013 [US1] Implement hybrid search: `websearch_to_tsquery('english')` + `ts_rank_cd` top 20, pgvector cosine top 20, RRF k=60, return ranked chunks with doc metadata in `lib/retrieval/hybrid.ts` — FR-004, R-07
- [ ] T014 [P] [US1] Unit-test the recall@5 metric: top 5 **distinct** doc IDs from the ranked list, plus every returned edge `source_doc` on graph routes, score = found ÷ min(5, |expected|), empty `expected_sources` skipped in `evaluation/runner/metrics/recall.ts` and `tests/unit/recall.test.ts` — SC-010, clarification 1

### Tier-1a eval runner (immediately after search)
- [ ] T015 [US1] Build eval runner CLI: load golden set, `--cases GS-001..GS-008,GS-018..GS-020` ranges, `--category`, `--mode baseline|graphrag|both`, `--runs`, dotenv `.env.local` in `evaluation/runner/cli.ts` — FR-018, FR-022
- [ ] T016 [US1] Implement Tier 1a: run `validate_seed.py`, call `lib/retrieval` directly (no chat model), compute recall@5 per case and mode in `evaluation/runner/tier1a.ts` — FR-020, FR-021
- [ ] T017 [US1] Write results + gates: `evaluation/results/<ts>-1a-<mode>.jsonl` (records date, models, embedding model, dataset hash), `summary.md`, milestone thresholds from spec §6, non-zero exit on gate failure, regression guard against `evaluation/results/last-pass.json` in `evaluation/runner/report.ts` — FR-018, Constitution III/VIII
- [ ] T018 [US1] Run `pnpm eval:fast` on the M2 cases; if recall@5 < 90%, tune chunking/k/RRF (not the fixture) until it passes; commit `last-pass.json` — SC-010 **(M2 gate)**

### Answering (still no UI)
- [ ] T019 [P] [US1] Define answer and router Zod schemas exactly as contracts/answer-schema.md (behaviour enum `answer|state_gap|clarify|refuse|draft`, claims with `key`, `citations` doc§|edge, `source_status` `effective_policy|proposal_or_meeting`) in `lib/agent/schemas.ts` — FR-006
- [ ] T020 [P] [US1] Implement confidence rule + citation filtering (drop citations not retrieved this turn; low/medium/high per contract) with unit tests first in `tests/unit/confidence.test.ts`, then `lib/agent/answer.ts` — FR-006, clarification 3
- [ ] T021 [US1] Implement `text` route answerer: hybrid search → Sonnet structured output → post-process → sanitised Markdown; `state_gap` when nothing passes; prefer effective-dated docs over `MTG-*` in `lib/agent/text-route.ts` and `lib/agent/prompts/answer.md` — FR-004, FR-007, FR-008
- [ ] T022 [US1] Add Tier-1a-style smoke script for GS-001, GS-017, GS-019 printing answer + confidence (manual check, not gated yet) in `evaluation/runner/smoke.ts` — US1

---

## Phase 4: M3 — Graph + router (Sat 17:00) · US2, US6

**Goal**: graph traversal and router live; route accuracy gated; first baseline vs graphrag comparison.
**Independent test**: `pnpm eval:fast --cases GS-009..GS-016,GS-021` (GS-009 path matches seed README) and `pnpm eval:model` → route accuracy ≥ 85% on all 30.

- [ ] T023 [US2] Implement graph loader from `nodes.csv`/`edges.csv` keeping `source_doc` and `condition`; validate `relation` ∈ the 15 relations in `data/graph_seed/README.md` in `lib/graph/load.ts` (called by `scripts/ingest.ts`) — FR-002
- [ ] T024 [US2] Integration test first: `graph_query` node mode from `SYS-CRM` reproduces the GS-009 hero traversal edges (incl. `APR-DO` → data owner resolved via `data_owner`) in `tests/integration/graph-hero.test.ts` — FR-005b
- [ ] T025 [US2] Implement `graph_query` three seed modes as parameterised recursive CTEs (node+`max_hops` ≤ 4 default 2 with relation allow-list; label with `classification`/`condition`; relation with limit), every edge returns `source_doc` in `lib/graph/query.ts` — FR-005b, ADR-005
- [ ] T026 [P] [US2] Implement condition parser (`key=value[|value]`) and system highest-classification helper in `lib/graph/conditions.ts` with tests in `tests/unit/conditions.test.ts` — FR-002
- [ ] T027 [P] [US2] Implement REF-005 approval resolver + controls/prerequisites (chain in PRC-012 §3 order, data owner via `data_owner` edge, Ledger Billing finance sign-off) in `lib/policy/approvals.ts` with tests for GS-009/GS-011/GS-015 in `tests/unit/approvals.test.ts` — FR-009
- [ ] T028 [US2] Unit tests first for router risk labels (every intent; one Restricted, one non-Restricted entity) in `tests/unit/router-risk.test.ts` — FR-003
- [ ] T029 [US2] Implement router: Haiku structured output (contracts/answer-schema.md router shape), deterministic unsafe pre-rules, code-computed risk, fixed FR-005a intent→route map, refusal → `unsafe` in `lib/router/index.ts`, `lib/router/prompts/router.md` — FR-003, FR-005a, ADR-008
- [ ] T030 [US2] Implement in-process MCP server + client over in-memory transport; tool registry with `risk` (`read`|`propose`|`write`) and `allowed_roles`; agent client allow-lists `read` + `propose` (unknown risk excluded) in `lib/mcp/server.ts`, `lib/mcp/client.ts` — FR-014, ADR-004
- [ ] T031 [P] [US2] Register read tools `search_documents`, `get_section`, `graph_query`, `lookup_approvals` per contracts/mcp-tools.md with Zod re-validation in `lib/mcp/tools/read.ts` — FR-014
- [ ] T032 [US2] Implement agent loop: ≤ 6 iterations, token cap, parallel tool results in one user message, `strict` tools, `stop_reason` refusal handling + `fallbacks: "default"` (Anthropic) in `lib/agent/loop.ts` — ADR-003, R-05, LLM10
- [ ] T033 [US2] Implement turn orchestrator: redact → router → route (`text` | `graph_local` | `graph_traversal` | `refuse` | `clarify`) → loop → answer; `mode=baseline` disables the graph tool in `lib/agent/turn.ts` — FR-004, FR-005, US6
- [ ] T034 [US2] Implement Tier 1b runner (full turn, fixed models/effort, route accuracy from the turn result, latency, cost; `--runs`) in `evaluation/runner/tier1b.ts` — FR-020, SC-004
- [ ] T035 [US2] Extend Tier 1a with graph recall (edge `source_doc` counts on graph routes) for GS-009–016, GS-021 in `evaluation/runner/tier1a.ts` — SC-010
- [ ] T036 [US6] Run `pnpm eval:fast --mode both --category multi_hop` and `pnpm eval:model`; tune router prompt until route accuracy ≥ 85%; record first baseline vs graphrag recall table in `evaluation/results/summary.md` — SC-004, US6 **(M3 gate)**

---

## Phase 5: M4 — Agent actions, confirmation gate, approval workflow (Sat 22:00) · US3, US4, US5

**Goal**: drafts → action confirmation → mock write → audit → approval workflow; safety and clarify behaviour.
**Independent test**: `pnpm eval:fast --category tool_selection` (confirmation compliance 100%, hook guard) and `pnpm eval:model --cases GS-022..GS-030`.

### Tests first (must fail before implementation)
- [ ] T037 [US3] Write failing integration test: no execution without confirmation — agent loop on GS-022 never calls a `write` tool; `access_requests` empty; agent tool list contains no `write` tool in `tests/integration/confirmation-gate.test.ts` — FR-010, SC-006
- [ ] T038 [P] [US3] Write failing integration test: confirm executes exactly once — status `pending_approvals`, audit `proposed`+`confirmed`+`executed`; second confirm returns same `request_id` with `idempotent_replay: true`; concurrent double confirm yields one row (DB unique `draft_id`); superseded/cancelled draft → 409 in `tests/integration/idempotency.test.ts` — FR-010, clarification 4
- [ ] T039 [P] [US3] Write failing integration test: hook guard — `/api/simulated-approver` rejects calls without `x-approver-panel` or with the agent context marker (403); no MCP tool can resume a hook in `tests/integration/hook-guard.test.ts` — FR-024a, SC-006

### Data and drafts
- [ ] T040 [US3] Write migration 002 for runtime tables: `drafts` (draft_id uuid PK, lineage_id, version int unique (lineage_id, version), kind `access_request|onboarding_ticket`, payload jsonb, approval_chain, warnings, policy_citations, status `proposed|confirmed|cancelled|superseded`, conversation_id), `access_requests` (`draft_id uuid UNIQUE`, `request_id` `AR-0001` sequence, status `pending_approvals|approved|rejected|expired`), `onboarding_tickets` (`TKT-0001`, `draft_id UNIQUE`), `approval_steps` (unique (request_id, seq), `decided_via` `simulated_approver_panel`), `audit_log` with `REVOKE UPDATE, DELETE` + raising trigger, and a status-transition check trigger in `lib/db/migrations/002_runtime.sql` — FR-010, FR-015
- [ ] T041 [P] [US3] Implement append-only audit writer (redacts `details`, events per data-model.md, actor labelled unverified) in `lib/audit/audit.ts` — FR-015
- [ ] T042 [P] [US3] Implement policy checks with unit tests: 90-day contractor PII max + 30-day exception (POL-014 §3.4/§4), contractor admin on Restricted prod not permitted (GS-015), vendor assessment expired or expires before `end_date` (VND-002, today = 2026-11-13) in `lib/policy/checks.ts`, `tests/unit/policy-checks.test.ts` — FR-011, FR-026
- [ ] T043 [P] [US3] Implement separation-of-duties warning with unit tests (sponsor = data owner → warning; distinct → none; never blocks) in `lib/policy/sod.ts`, `tests/unit/sod.test.ts` — FR-023
- [ ] T044 [US3] Implement immutable drafts: create (policy check first, then required fields `requester_name, requester_type, sponsor, system_id, access_level, duration_days, justification`; `needs_fields` / `blocked` results), supersede (new version, old → `superseded`), cancel in `lib/drafts/drafts.ts` — FR-009, FR-011, clarifications 2 & 4
- [ ] T045 [US3] Register `propose_access_request` and `propose_onboarding_ticket` (`risk: "propose"`; onboarding fields `contractor_name, vendor?, sponsor, start_date, end_date, restricted_access_expected`) and `check_policy` (read) in `lib/mcp/tools/propose.ts` — FR-009, FR-014, FR-026
- [ ] T046 [US3] Implement idempotent execution + write tools `create_access_request` / `create_onboarding_ticket` (`risk: "write"`, require `ConfirmationEvent` in call context, insert with `ON CONFLICT (draft_id) DO NOTHING` then read back) in `lib/drafts/execute.ts`, `lib/mcp/tools/write.ts` — FR-010, FR-026
- [ ] T047 [US3] Implement `POST /api/drafts/[id]/confirm` and `/cancel` per contracts/http-api.md (409 for non-submittable; emits `access_request.submitted`) in `app/api/drafts/[id]/confirm/route.ts`, `app/api/drafts/[id]/cancel/route.ts` — FR-010, FR-024; T037–T038 now pass

### Approval workflow
- [ ] T048 [US3] Define `ApprovalEngine` interface (`start`, `status`, `resume`) and the in-memory fallback state machine with identical states/events and audit per transition in `lib/workflow/engine.ts`, `lib/workflow/in-memory.ts` — FR-024
- [ ] T049 [US3] Verify the Vercel Workflow API against its docs (`"use workflow"`, `"use step"`, hooks, `sleep`, `withWorkflow`), then implement `approvalWorkflow`: hook per approver `${requestId}:${role}` raced against scaled SLA `sleep()`, `sla_breached` escalation, one step per transition writing `approval_steps` + audit, auto-delete for test runs in `lib/workflow/approval.workflow.ts`, `next.config.ts` — FR-024, FR-024b, R-10
- [ ] T050 [US3] Implement `POST /api/simulated-approver` (panel header + same-origin, rejects agent context, resumes hook via engine) and `GET /api/requests/[id]` timeline in `app/api/simulated-approver/route.ts`, `app/api/requests/[id]/route.ts` — FR-024a; T039 now passes
- [ ] T051 [US3] **TIME-BOX CHECKPOINT — Sat 22:00**: if the Vercel Workflow path (T049) does not pass T039 and a full sponsor→privacy run with an SLA breach locally, set `APPROVAL_ENGINE=in-memory`, record the decision and reason in `specs/001-access-impact-copilot/research.md` R-10 and the README limitations, and move on. Do not spend more time on it before M5 — ADR-006, PRD §10.1 cut line

### Safety and clarify
- [ ] T052 [P] [US4] Implement `refuse` route: no tools offered, legitimate path (PRC-012 §7 emergency access; POL-014 export approval), "governance knowledge, not customer data" for record requests in `lib/agent/refuse-route.ts`, `lib/agent/prompts/refuse.md` — FR-012
- [ ] T053 [P] [US5] Implement `clarify` route: exactly one question covering system/data, requester type, access level (and duration/justification for actions) in `lib/agent/clarify-route.ts`, `lib/agent/prompts/clarify.md` — FR-013
- [ ] T054 [US3] Wire `action` route into the turn orchestrator: breach reported before missing fields; draft returned in the turn result in `lib/agent/turn.ts` — FR-009, FR-011
- [ ] T055 [US3] Add Tier-1a confirmation compliance + hook-guard checks (simulated no-confirm run, then Submit; asserts per evaluation/README.md) in `evaluation/runner/tier1a.ts` — SC-006
- [ ] T056 [US3] Add Tier-1b tool correctness (`expected_tool`/args, names normalised, dates ±3 days, `flag_and_propose` must not contain breaching value), safe behaviour and clarify metrics in `evaluation/runner/metrics/tools.ts`, `evaluation/runner/tier1b.ts` — SC-005, SC-007
- [ ] T057 [US3] Run M4 evals; fix until tool correctness ≥ 90% (GS-022–025), confirmation compliance 100%, safe behaviour 100% (GS-026–028); update `last-pass.json` — SC-005, SC-006, SC-007 **(M4 gate)**

### Minimum UI (first UI work)
- [ ] T058 [US1] Implement `POST /api/chat` (rate limit, daily spend cap, 503 on upstream failure) in `app/api/chat/route.ts` — FR-006, PRD §8.2
- [ ] T059 [US1] Build chat page with evidence panel (route, confidence, citation chips, graph path, assumptions, gaps, trace link, SIMULATED badge) in `app/page.tsx`, `app/components/EvidencePanel.tsx` — US1, US2
- [ ] T060 [US3] Build draft approval card (keyboard-operable, SoD warning, prerequisites, policy check, Submit/Cancel; "Submit request" wording) and status timeline in `app/components/DraftCard.tsx`, `app/components/Timeline.tsx` — US3, FR-023, FR-024
- [ ] T061 [P] [US3] Build Simulated approver panel (one button per role) and audit log page in `app/approver/page.tsx`, `app/audit/page.tsx`, `app/api/audit/route.ts` — FR-024a, FR-015

---

## Phase 6: M5 — Judge evals, CI gate, observability (Sun 12:00, feature freeze) · US6

**Goal**: Tier 2 in both modes, CI gates, Langfuse traces with latency and cost.
**Independent test**: `pnpm eval:full --mode both`; `pnpm eval:model --runs 3`; CI green.

- [ ] T062 [P] Implement Langfuse tracing: trace per turn with intent, risk, route, retrievals, graph edges, tool calls (redacted args), draft IDs, behaviour, confidence, tokens, cost from a price table, latency; redact before send in `lib/observability/langfuse.ts` — FR-016, Constitution IV
- [ ] T063 [P] [US6] Write versioned judge prompts (claims split + support check, citation support, answer-point coverage; strict JSON output) in `evaluation/judges/groundedness.v1.md`, `citation.v1.md`, `completeness.v1.md` — SC-001–SC-003
- [ ] T064 [US6] Implement Tier 2 runner with `JUDGE_MODEL` (Opus, fixed effort), behaviour-case rule for `state_gap`/`clarify`, both modes in `evaluation/runner/tier2.ts` — FR-020, SC-001–SC-003
- [ ] T065 [US6] Add 3-run variation report (min/max/mean per Tier-1b metric) and the metric × mode × category table in `evaluation/runner/report.ts` — FR-021, SC-008, SC-009
- [ ] T066 [P] Add CI: `eval-fast.yml` on every push (validator, tsc, Vitest, Neon branch migrate + ingest, Tier 1a) in `.github/workflows/eval-fast.yml` — FR-019
- [ ] T067 [P] Add CI: `eval-pr.yml` on PRs to `main` (Tier 1b + Tier 2, secrets, Neon branch create/delete) in `.github/workflows/eval-pr.yml` — FR-019
- [ ] T068 [US6] Run `eval:full --mode both` and `eval:model --runs 3`; hand-check ≥ 10 cases and log disagreements in `docs/evaluation-results.md` — SC-001–SC-003, Constitution VIII **(M5 gate)**
- [ ] T069 [P] Implement personal-name redaction (Should; graph `Person` allow-list) in `lib/observability/redact.ts` — FR-017 (cut first if behind)
- [ ] T070 [P] [US6] Add "Compare with baseline" toggle re-running the turn with `mode=baseline` side by side in `app/components/CompareToggle.tsx` — US6 (Should; cut if behind)

---

## Phase 7: M6 — Deploy and docs (Sun 16:00)

- [ ] T071 Deploy to Vercel: env vars, Neon production branch, run migrate + ingest, smoke the hero flow (quickstart.md walkthrough) — ADR-001
- [ ] T072 [P] Write README: one-liner, demo GIF placeholder, live link, problem, architecture diagram, results table (as measured), governance, limitations (incl. any T051 fallback), quickstart, roadmap in `README.md` — PRD §13
- [ ] T073 [P] Verify fresh clone → running locally in ≤ 10 min following `specs/001-access-impact-copilot/quickstart.md`; fix gaps — PRD §8.2

## Phase 8: M7 — Launch (Sun 19:00)

- [ ] T074 Record ≤ 2-min demo video following PRD §5 steps 2–8; add GIF to `README.md` — PRD §13
- [ ] T075 [P] Draft LinkedIn post and résumé bullets from measured results in `docs/launch.md` — PRD §13

---

## Dependencies

- Setup (T001–T005) → Foundational (T006–T009) → M2 → M3 → M4 → M5 → M6 → M7.
- M2: T010 → T012 → T013 → T015 → T016 → T017 → T018. T011 runs alongside T010. T014 runs alongside T013.
- M3 needs T013 (search) and T017 (runner). T024 comes before T025. T028 comes before T029. T030 comes before T031 and T045.
- M4: T037–T039 come before T040–T050. T040 comes before T041 and T044–T047. T048 comes before T049 and T050. T051 runs at 22:00 whatever state the work is in. UI (T058–T061) needs T033 and T047.
- M5 needs the M4 gate (T057). T066 can start right after T017.
- Story completion order: US1 (M2) → US2 (M3) → US3/US4/US5 (M4) → US6 (M5). US4 and US5 depend only on the router (T029).

## Parallel examples

- **M2:** T011 (embeddings) alongside T010 (ingest). T014 (recall metric) alongside T013 (search). T019 and T020 together.
- **M3:** T026, T027 and T031 together, after T025 and T030.
- **M4:** T038 and T039 alongside T037. T041, T042 and T043 together after T040. T052 and T053 together.
- **M5:** T062, T063, T066 and T067 together.

## Implementation strategy

1. **MVP = M2 (US1):** cited lookups, gated by recall@5 in Tier 1a, with no UI. This is the first thing that can be shown working.
2. Each later milestone adds one gated slice: graph and router (M3), the governed action plus approvals (M4), judge evals and CI (M5).
3. Cut line, in order: in-memory approvals (T051) → eval dashboard page (not planned; README table instead) → baseline toggle (T070) → name redaction (T069). Never cut: T037–T039 gates, citations, regex redaction (T009), Tier-1a CI (T066).
