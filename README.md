# Enterprise Operations Copilot — Access & Impact Governance

> **One-liner:** A citation-grounded GraphRAG & MCP operations copilot that answers enterprise access, dependency, and policy questions with verifiable evidence and drafts policy-checked access requests behind a two-stage human confirmation and multi-step organisational approval gate.

---

## Live Demo & Walkthrough

- **Live Deployment:** `[Live Link Placeholder — https://enterprise-operation-copilot.vercel.app]`
- **Demo Walkthrough GIF:**

![Demo Walkthrough Placeholder](docs/assets/demo-placeholder.gif)
*(Placeholder — 2-minute hero flow walkthrough GIF added in M7 / T074)*

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

## Measured Evaluation Results (v0.1 Tier 1a)

Results measured via `pnpm eval:fast` on the 20-case golden evaluation suite (`evaluation/results/summary.md`, dataset `72a625175df3`, embedding `voyage-3.5`). Tier 1b and Tier 2 LLM-as-judge evaluations are scheduled for **v0.2**.

### Gate Summary

| Tier | SC | Metric | Mode | Measured Value | Threshold | Cases | Status |
|---|---|---|---|---|---|---|---|
| **Tier 1a** | SC-010 | `recall_at_5` (hybrid) | `baseline` | **89.4%** (89% table mean) | — (diagnostic) | 19 | Reported (not gated) |
| **Tier 1a** | SC-010 | `recall_at_5` (hybrid) | `graphrag` | **100.0%** | ≥ 90% | 19 | ✅ **PASS** |
| **Tier 1a** | SC-006 | `confirmation_compliance` | `baseline` | **100.0%** | — (diagnostic) | 1 | Reported (not gated) |
| **Tier 1a** | SC-006 | `confirmation_compliance` | `graphrag` | **100.0%** | 100% | 1 | ✅ **PASS** |
| **Tier 1b** | SC-004 / SC-005 / SC-007 | Deterministic route, entity & citation checks | `both` | *v0.2* | *v0.2* | — | **v0.2** |
| **Tier 2** | SC-001 – SC-003 | Groundedness, citation support, completeness (Opus judge) | `both` | *v0.2* | *v0.2* | — | **v0.2** |

### Tier 1a Retrieval Comparison (`baseline` vs `graphrag`)

| Mode | `recall@5` (hybrid) | `coverage` (hybrid) | `MRR` (hybrid) |
|---|---|---|---|
| `baseline` (hybrid text + vector RRF only) | 89% | 89% | 0.85 |
| `graphrag` (hybrid text + `graph_query` / entity-seeded traversal) | **100%** | **100%** | **0.85** |

Multi-hop dependency and cross-document governance cases (`GS-009`, `GS-011`, `GS-014`, `GS-015`, `GS-016`) improve from 40%–75% recall@5 in `baseline` mode to **100%** in `graphrag` mode.

---

## Governance & Safety Gates

1. **Citation-Grounded Claims Only (Constitution I):** Every factual claim in `FinalAnswer` carries `[doc_id §section]` citations verified against the turn's retrieved chunks and graph edges (`filterCitations`). Unbacked citations are stripped; if no claim remains supported, the turn degrades safely to `state_gap`.
2. **Refusal of Approval Bypass & Unsafe Requests (Constitution II, T051):** Prompts attempting to bypass approvals, share credentials, or circumvent security controls are intercepted by deterministic pre-rules and the router, returning `behaviour: "refuse"` with the governing policy citation and legitimate compliance path.
3. **Two-Stage Human Confirmation & Organisational Approval Gate (Constitution III, FR-010, FR-024, FR-024a):**
   - **Agent MCP Boundary (`T038`):** The agent loop only mounts `read` and `propose` MCP tools. Write tools (`create_access_request`) are physically excluded from the agent's MCP server and require a cryptographic/structural `ConfirmationEvent` injected only by `POST /api/drafts/{id}/confirm`.
   - **Pre-Flight & Confirm-Time Policy Re-Check (`T042`, `T046`, `T053`):** Checks maximum duration (≤ 90 days), vendor assessment status/expiry, restricted-access rules, and Separation-of-Duties (SoD) conflicts both when proposing a draft and again at confirmation time, reporting breaches and compliant alternatives before prompting for missing fields.
   - **Idempotent Execution (`T039`, `T044`):** Confirming the same `draft_id` multiple times executes at most once and replays the existing `request_id` (`AR-0001`).
   - **Isolated Simulated Approver Hook Guard (`T040`, `T049`):** `POST /api/simulated-approver` rejects any request carrying agent context headers (`x-agent-context`, `x-mcp-caller: agent`), requires `x-approver-panel: 1`, and enforces same-origin checks.
4. **PII Redaction & Observability (Constitution IV, FR-016, FR-017, T059):** Emails, payment card numbers, phone numbers, and non-allowlisted IDs are redacted via `redact()` / `redactDeep()` before reaching logs, audit details, or Langfuse traces (`lib/observability/langfuse.ts`).

---

## Known Limitations (v0.1)

- **In-Memory Approval Workflow Engine (`APPROVAL_ENGINE=in-memory`, T047/T050 fallback):** v0.1 ships with the in-memory approval timeline and configurable SLA timer (`SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY=60` for live demo inspection) backed by Postgres audit log persistence. Durable multi-instance execution via `@vercel/workflow` (`APPROVAL_ENGINE=vercel-workflow`, T050) is deferred to v0.2.
- **Tier 1b / Tier 2 LLM-as-Judge Evaluations:** v0.1 gates on Tier 1a (`SC-010` hybrid recall@5 = 100% and `SC-006` confirmation compliance = 100%). Full end-to-end LLM-as-judge evaluations (`T060`–`T062`, `T065`) are scoped to v0.2.
- **Provider Scope:** v0.1 defaults to Anthropic (`claude-haiku-5-5` router, `claude-sonnet-5-5` agent) and Voyage (`voyage-3.5` 1024-d embeddings). AWS Bedrock runtime adapter (`T068`) and contractor onboarding ticket write tools (`T069`) are v0.2 items.

---

## Quickstart

### Prerequisites
- **Node.js** ≥ 22 (`pnpm` 10+)
- **Python** ≥ 3.11 (for `scripts/validate_seed.py`)
- **PostgreSQL 16 + `pgvector`** (or a Neon Postgres database URL)
- **API Keys:** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` (and optional `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`)

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment
Copy `.env.example` to `.env.local` and set your credentials:
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

### 3. Validate Seed Corpus, Migrate & Seed Database
```bash
python scripts/validate_seed.py
pnpm db:migrate
pnpm db:seed
```

### 4. Run Tests & Tier-1a Evaluation
```bash
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm eval:fast
```

### 5. Start the Application
```bash
pnpm dev
```
Open `http://localhost:3000` to explore the preset operational queries, inspect citation and graph path evidence in the side panel, confirm a proposed access request draft, and step through the simulated organisational approver timeline.

---

## v0.2 Roadmap

- **Durable Approval Workflows (`T050`):** `@vercel/workflow` engine option (`APPROVAL_ENGINE=vercel-workflow`) with deterministic hook resumption across serverless cold starts.
- **Tier 1b & Tier 2 Judge Evaluation Suite (`T060`–`T065`, `T070`):** Versioned Opus judge prompts (`groundedness.v1.md`, `citation.v1.md`, `completeness.v1.md`), 3-run variance reporting, PR evaluation workflow (`eval-pr.yml`), and `/evals` UI dashboard.
- **Clarify Route & Compare Toggle (`T052`, `T067`):** Dedicated single-question clarification route for underspecified entity queries and side-by-side `graphrag` vs `baseline` comparison toggle in the chat UI.
- **Contractor Onboarding Tickets (`T069`):** `propose_onboarding_ticket` and `create_onboarding_ticket` (`TKT-0001`) with vendor security assessment expiry checks.
- **AWS Bedrock Provider (`T068`) & Graph-Backed Name Redaction (`T066`).**
