# Enterprise Operations Copilot — Access & Impact Governance

> **One-liner:** A citation-grounded GraphRAG & MCP operations copilot that answers enterprise access, dependency, and policy questions with verifiable evidence and drafts policy-checked access requests behind a two-stage human confirmation and multi-step organisational approval gate.

---

## Live Demo & Walkthrough

- **Live Deployment:** [https://enterprise-operations-copilot.vercel.app](https://enterprise-operations-copilot.vercel.app)
- **Evaluation Dashboard:** [https://enterprise-operations-copilot.vercel.app/evals](https://enterprise-operations-copilot.vercel.app/evals)
- **Demo Walkthrough Overview:**

![Enterprise Operations Copilot Hero Walkthrough](docs/assets/demo-walkthrough.svg)
*(Continuous animated vector walkthrough of the 4-stage hero flow: direct lookup → multi-hop GraphRAG → governed draft &amp; SoD → idempotent execution &amp; approver timeline)*

---

## The Problem

Enterprise operations, security, and platform teams field hundreds of recurring questions and requests every week:
1. **Multi-hop access & dependency questions** (*"What approvals and policies govern temporary contractor access to restricted production analytics systems, and what downstream services depend on them?"*) span policy documents, system registries, vendor assessments, and incident reports. Standard vector/hybrid RAG misses multi-hop structural dependencies across systems, roles, vendors, and policies.
2. **Unsafe or non-compliant access requests** (*e.g., requesting 180-day contractor access when policy caps temporary access at 90 days, expired vendor security assessments, or Separation-of-Duties [SoD] conflicts*) waste approver time when submitted without pre-flight policy validation.
3. **Uncontrolled agent write actions** create audit and compliance risk if an LLM can directly execute state-changing tools or self-approve organisational workflows without explicit human confirmation and isolated approver controls.

---

## Architecture

```mermaid
flowchart TD
  U["User / Operator (Next.js Chat UI)"] -->|"POST /api/chat"| R["PII Redactor (redact.ts)"]
  R --> RT["Hybrid Pre-Rules + Haiku Router (lib/router)"]
  RT -->|"route = text"| TR["Hybrid RRF Retrieval (FTS + pgvector)"]
  RT -->|"route = graph_local | graph_traversal"| GR["MCP Read Loop (graph_query, lookup_approvals, search_documents, get_section)"]
  RT -->|"route = action"| AR["MCP Action Loop (Read Tools + check_policy + propose_access_request)"]
  RT -->|"route = refuse"| RF["Refuse Route (Policy Citation + Legitimate Path)"]

  TR --> POST["Citation Filter + Confidence Scorer (answer.ts)"]
  GR --> POST
  AR --> POST
  RF --> POST

  AR -->|"Creates Proposed Draft"| DB[("Neon Postgres + pgvector\ndocuments / chunks / graph_nodes / graph_edges\ndrafts / access_requests / audit_log")]
  TR --> DB
  GR --> DB

  POST -->|"TurnResult + DraftCard + EvidencePanel"| U
  POST -->|"Redacted Turn Trace"| LF["Langfuse Observability (lib/observability/langfuse.ts)"]

  U -->|"Stage 1: POST /api/drafts/:id/confirm"| CF["Confirm Client (Write Gate + Policy Re-check + Idempotency)"]
  CF -->|"create_access_request"| DB
  CF -->|"access_request.submitted"| WF["Approval Engine (in-memory timeline + SLA timer)"]
  U -->|"Stage 2: POST /api/simulated-approver\n(x-approver-panel: 1, non-agent guard)"| WF
  WF -->|"Step Decisions & SLA Events"| DB
  CF --> LF
  WF --> LF
```

---

## Measured Evaluation Results

All numbers below come from one canonical run per tier, over the 30-case golden suite (`evaluation/golden_set.jsonl`, dataset `72a625175df3`, embedding `voyage-3.5`, router `claude-haiku-5-5`, agent `claude-sonnet-5-5`, judge `claude-opus-5-5`):

| Tier | Canonical run (in `evaluation/results/`) | Timestamp (UTC) | What it covers |
|---|---|---|---|
| **1a** (`eval:fast`, no model calls) | `2026-11-14T04-49-27-342Z-1a-{graphrag,baseline}.jsonl` | 2026-11-14 04:49:27 | Retrieval recall@5, confirmation compliance |
| **1b** (`eval:model`, 3 runs) | `2026-11-14T05-35-57-071Z-1b-graphrag.jsonl` | 2026-11-14 05:35:57 | Route, tool, safety, clarify, latency, cost (90 turns) |
| **2** (`eval:full`, Opus judge) | `2026-11-14T05-41-22-177Z-2-{graphrag,baseline}.jsonl` | 2026-11-14 05:41:22 | Groundedness, citation accuracy, completeness |

Full per-category breakdown and a 12-case hand-check audit: [`docs/evaluation-results.md`](docs/evaluation-results.md). The `/evals` page renders `evaluation/results/summary.md`, which is the most recent single Tier-1b run, not the canonical 3-run file above.

### Gate Summary

| Tier | SC | Metric | Mode | Measured | Threshold | Cases | Status |
|---|---|---|---|---|---|---|---|
| 1a | SC-010 | `recall_at_5` (hybrid) | `graphrag` | **92.9%** | ≥ 90% | 26 | ✅ PASS |
| 1a | SC-010 | `recall_at_5` (hybrid) | `baseline` | 85.2% | reported | 26 | — |
| 1a | SC-006 | `confirmation_compliance` | `graphrag` | **100.0%** | 100% | 4 | ✅ PASS |
| 1b | SC-004 | `route_accuracy` | `graphrag` | **100.0%** (all 3 runs) | ≥ 85% | 30 × 3 | ✅ PASS |
| 1b | SC-005 | `tool_correctness` (`GS-022..GS-025`) | `graphrag` | **mean 91.7%**, min 75.0%, max 100.0% | ≥ 90% | 4 × 3 | ✅ PASS (mean) |
| 1b | SC-007 | `safe_behaviour` (`GS-026..GS-028`) | `graphrag` | **100.0%** (all 3 runs) | 100% | 3 × 3 | ✅ PASS |
| 1b | SC-008 | Latency, all turns | `graphrag` | p50 **4,927 ms** · p95 **28,678 ms** | p95 ≤ 10 s (report) | 90 turns | ❌ Not met |
| 1b | SC-009 | Copilot cost per request | `graphrag` | mean **$0.0184** · total $1.658 | reported (≤ $0.02 target) | 90 turns | Within target |
| 2 | SC-001 | `groundedness` (Opus judge) | `graphrag` | **91.7%** | ≥ 90% | 30 | ✅ PASS |
| 2 | SC-002 | `citation_accuracy` (Opus judge) | `graphrag` | **95.1%** | ≥ 90% | 27 | ✅ PASS |
| 2 | SC-003 | `completeness` (`multi_hop`) | `graphrag` vs `baseline` | **90.6%** vs 34.8% | ≥ baseline + 20 pts (report) | 8 | Met (+55.8 pts) |

Tool correctness: the only failure across the three runs is `GS-024` in run 1. Tier 2 recall@5 for the same cases is 100.0% (graphrag) vs 85.2% (baseline); the Tier 1a figure above is the deterministic no-model run.

### `baseline` vs `graphrag` (Tier 2 run)

| Metric | `baseline` (hybrid text) | `graphrag` (hybrid text + graph) | Difference |
|---|---|---|---|
| `recall@5` (26 cases with expected sources) | 85.2% | **100.0%** | +14.8 pts |
| `recall@5` (`multi_hop`, 8 cases) | 74.8% | **100.0%** | +25.2 pts |
| `completeness` (`multi_hop`, 8 cases) | 34.8% | **90.6%** | +55.8 pts |
| `route_accuracy` (30 cases) | 100.0% | 100.0% | 0 |
| `groundedness` (30 cases) | **94.1%** | 91.7% | **−2.4 pts** |
| `groundedness` (`tool_selection`, 4 cases) | **83.3%** | 70.8% | **−12.5 pts** |
| `citation_accuracy` (27 cases) | **95.2%** | 95.1% | −0.1 pts |
| mean cost per request (copilot turns) | $0.0093 | $0.0198 | +$0.0105 |

**Known trade-off:** graphrag answers are far more complete on multi-hop questions, but they are *less* grounded than baseline answers (91.7% vs 94.1%). The weakest category is `tool_selection` at 70.8%, driven mostly by `GS-023` (0.333): the answer added a `start_date` missing field the tool never returned and applied the 90-day rule to "Restricted" data, which the retrieved evidence did not say. Longer, graph-enriched answers make more claims, and more of them go beyond the retrieved evidence. graphrag also costs about twice as much per turn.

### How to read these numbers

- **The knowledge graph is hand-curated** from the 15 synthetic documents in `data/raw/`. Nothing is extracted automatically.
- **The golden set and the graph have the same author.** 100% graphrag recall shows the traversal finds what the author connected. It is an upper bound on this fixture, not evidence that the approach generalises to unseen documents or questions.
- **Router accuracy** was 90% before prompt tuning and 100% on a single run after; the canonical 3-run file above then shows 100% in each run. The pre-tuning run is not kept in `evaluation/results/`. The router prompt was tuned against this same golden set.
- **`GS-015` is a known answer-quality failure** (completeness 0.25). Asked who approves contractor admin access to Pulse HRIS, the copilot lists an approval chain instead of leading with the fact that contractor admin access to a Restricted production system is not permitted (POL-022 §4), with exceptions only through POL-041.
- 30 cases, one synthetic company, one judge model. Treat differences of a few points as noise.

---

## Governance & Safety Gates

1. **Citation-Grounded Claims Only (Constitution I):** Every factual claim in `FinalAnswer` carries `[doc_id §section]` citations checked against the turn's retrieved chunks and graph edges (`filterCitations`). Unbacked citations are stripped; if no claim remains supported, the turn degrades to `state_gap`. This checks that a citation *exists in the evidence*, not that it supports the claim; the Tier 2 judge measures support (see the groundedness trade-off above).
2. **Refusal of Approval Bypass & Unsafe Requests (Constitution II, T051):** Prompts that try to bypass approvals, share credentials or circumvent controls are caught by deterministic pre-rules and the router, and return `behaviour: "refuse"` with the governing policy citation and the legitimate path.
3. **Two-Stage Human Confirmation & Organisational Approval Gate (Constitution III, FR-010, FR-024, FR-024a):**
   - **Structural write boundary (`T038`):** the agent loop mounts only `read` and `propose` MCP tools. Write tools (`create_access_request`, `create_onboarding_ticket`) are absent from the agent's MCP tool list, so the model never sees them; the in-process MCP server also rejects any `write` call that does not come from the confirm caller with a matching `ConfirmationEvent`, which is constructed only by `POST /api/drafts/{id}/confirm` (`lib/mcp/client.ts`, `lib/mcp/server.ts`). This boundary is enforced by code structure, not by the prompt, and is checked by SC-006.
   - **Pre-flight and confirm-time policy re-check (`T042`, `T046`, `T053`):** maximum duration (≤ 90 days), vendor assessment status and expiry, Restricted-access rules and Separation-of-Duties conflicts are checked when the draft is proposed and again at confirmation.
   - **Idempotent execution (`T039`, `T044`):** confirming the same `draft_id` repeatedly executes at most once and replays the existing `request_id`.
   - **Simulated approver guard (`T040`, `T049`):** `POST /api/simulated-approver` rejects requests carrying agent-context headers (`x-agent-context`, `x-mcp-caller: agent`), requires `x-approver-panel: 1`, and checks the `Origin` host. This is a **demo guard**, not security: anyone with `curl` can set those headers and approve a request.
   - **No authentication:** the demo has no auth on the confirm route or the approver route. Anyone who can reach the deployment can confirm drafts and approve steps.
4. **PII Redaction & Observability (Constitution IV, FR-016, FR-017, T059, T066):** emails, payment card numbers, phone numbers, non-allowlisted IDs and personal names not in the graph's Person allow-list are redacted by `redact()` / `redactDeep()` before reaching logs, audit details or Langfuse traces (`lib/observability/`).

---

## Feature Status

| Feature | Where | Status |
|---|---|---|
| Text, graph and action routes with citations, assumptions, gaps, confidence | `lib/router`, `lib/agent` | Shipped, evaluated (Tiers 1a, 1b, 2) |
| Clarify route (single clarifying question) | `lib/router`, `GS-029`, `GS-030` | Shipped, evaluated (clarify 100% in all 3 Tier-1b runs) |
| Contractor onboarding tickets (`propose_onboarding_ticket`, `create_onboarding_ticket`) with vendor-assessment expiry check | `lib/mcp/tools/propose.ts`, `lib/mcp/tools/write.ts` | Shipped, evaluated (`GS-024`; failed tool correctness in 1 of 3 runs) |
| Tier 1b / Tier 2 eval runner, versioned judge prompts, `eval-pr.yml` | `evaluation/runner`, `.github/workflows` | Shipped, run (canonical files above) |
| `/evals` dashboard | `app/evals/page.tsx` | Shipped (renders `evaluation/results/summary.md`) |
| `graphrag` vs `baseline` compare toggle in the chat UI | `app/components/CompareToggle.tsx` | Shipped; the two modes are evaluated by the runner, the UI toggle itself has no automated test |
| Graph-backed personal-name redaction (`T066`) | `lib/observability/redact.ts` | Shipped |
| Amazon Bedrock chat provider (`MODEL_PROVIDER=bedrock`) | `lib/model/bedrock.ts` | **Implemented, not yet evaluated**: no eval run used Bedrock |
| Durable approval workflow (`APPROVAL_ENGINE=vercel-workflow`) | `lib/workflow/approval.workflow.ts` | **Code drafted, not wired, not evaluated**: the adapter still delegates to the in-memory engine, `workflow` is not a dependency and `next.config.ts` has no `withWorkflow`. On the roadmap |

## Known Limitations

- **In-memory approval engine (default, `APPROVAL_ENGINE=in-memory`):** approval timelines and SLA timers live in process memory. On serverless (Vercel), a later request can land on a different instance or a cold start, so a timeline can be lost or appear stale. The Postgres `audit_log` (append-only) and the `access_requests` rows do persist.
- **p95 latency** over all Tier-1b turns is 28,678 ms, above the 10 s target; multi-hop graph turns are the slowest.
- **Groundedness trade-off:** graphrag is below baseline on groundedness (91.7% vs 94.1%; `tool_selection` 70.8%).
- **`GS-015`** answer-quality failure and **`GS-024`** tool-correctness variance (see above).
- **No auth**, demo-grade approver guard, synthetic data only, single tenant.

---

## Quickstart

### Prerequisites
- **Node.js** ≥ 22 and < 25 (`engines` in `package.json`); **pnpm** 11 (`packageManager: pnpm@11.21.0`, via Corepack)
- **Python** ≥ 3.11 (for `scripts/validate_seed.py`)
- **PostgreSQL 16 + `pgvector`** (or a Neon Postgres database URL)
- **API keys:** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` (optional: `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`)

### 1. Install dependencies
```bash
pnpm install
```

### 2. Configure environment
```bash
cp .env.example .env.local
```
Required settings in `.env.local`:
```ini
DATABASE_URL=postgresql://user:password@host:5432/dbname
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
APPROVAL_ENGINE=in-memory
SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY=60
```

### 3. Validate fixtures, migrate and ingest
```bash
pnpm validate        # python scripts/validate_seed.py
pnpm db:migrate
pnpm ingest          # documents → chunks + embeddings; graph seed → nodes/edges
```

### 4. Run tests and evaluations
```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration   # needs DATABASE_URL
pnpm eval:fast          # Tier 1a, no model calls
pnpm eval:model         # Tier 1b, model in the loop (costs API credits)
pnpm eval:full          # Tier 2, Opus judge (costs API credits)
```

### 5. Start the application
```bash
pnpm dev
```
Open `http://localhost:3000` to try the preset questions, inspect citations and graph paths in the evidence panel, confirm a proposed draft, and step through the simulated approver timeline.

---

## Roadmap

- **Durable approval workflow (`T050`):** finish the Vercel Workflow engine (add the `workflow` dependency and `withWorkflow`, run hooks and SLA `sleep()` for real instead of delegating to in-memory), then evaluate it.
- **Evaluate the Bedrock provider (`T068`):** run Tier 1b and Tier 2 with `MODEL_PROVIDER=bedrock` and publish the comparison.
- **Fix `GS-015`:** lead with "not permitted" for contractor admin access to Restricted production systems.
- **Stabilise `GS-024`** tool correctness across runs, and record failing tool and arguments in the result files.
- **Reduce latency** on multi-hop graph turns towards p95 ≤ 10 s.
- **Generalisation check:** questions and documents written by someone other than the graph author.
- **Auth** on the confirm and approver routes.
