# CLAUDE.md: Enterprise Operations Copilot

## What this is
A weekend portfolio PoC: a governed GraphRAG + agentic copilot that answers access-governance questions for a fictional company (Kestrel Financial Group), reasons across policies → systems → data classes → controls → approvers, and drafts access requests that a human must approve. Built to demonstrate the AI automation engineering skills in a job description: agentic workflows, GraphRAG, semantic search, evaluation, observability and governance.

**Deadline:** published on GitHub with a live demo by Sunday 15 Nov 2026, evening (Melbourne).

## Read these first, in order
1. `.specify/memory/constitution.md`: non-negotiable rules. They override everything else.
2. `docs/PRD.md`: why, users, the end-to-end hero journey (§5, also the demo script), UX wireframes (§6), MoSCoW scope (§7), NFRs and OWASP LLM mapping (§8), weekend milestones and cut line (§10).
3. `specs/001-access-impact-copilot/spec.md`: what to build (US1–US6, FR-001–FR-025 incl. FR-005a/b, FR-024a/b, SC-001–SC-010).
4. `data/graph_seed/README.md`: graph schema and the hero traversal (GS-009).
5. `evaluation/golden_set.jsonl` and `evaluation/README.md`: the acceptance tests, the eval tiers, and when each metric switches on.

When the PRD and the spec disagree, the spec wins for requirements and the PRD wins for priority and scope. Flag any conflict you find.

## Workflow: spec-driven development (GitHub Spec Kit)
`/speckit.plan` → `/speckit.tasks` → `/speckit.analyze` → `/speckit.implement`
- Implement **one task at a time**. Every task references an FR-xxx ID.
- **Build the Tier-1 eval runner during M2** (FR-021), right after basic retrieval works. It's an early task, not a Sunday task.
- After every task, run `eval:fast` on the cases the current milestone covers (see `evaluation/README.md`), and include the result in the commit message. Don't start the next task while a previously passing case is failing.
- To change behaviour, update the spec and golden set first, then the code.
- Do not edit `data/raw/`, `data/graph_seed/` or `evaluation/golden_set.jsonl` without asking. They are the fixed test fixture. After any change, run `python3 scripts/validate_seed.py`.

## Stack (record each as an ADR in plan.md)
- **ADR-001 App:** TypeScript, Next.js (App Router), deployed on Vercel.
- **ADR-002 Data:** Neon Postgres. pgvector + full-text search for hybrid retrieval; graph stored as `nodes` / `edges` tables, traversed with recursive CTEs. No Neo4j: 66 nodes don't justify a second datastore.
- **ADR-003 Agent runtime:** a hand-written tool-use loop on the Anthropic TypeScript SDK (`@anthropic-ai/sdk`), with Amazon Bedrock as a second provider (`@anthropic-ai/bedrock-sdk`), selected by `MODEL_PROVIDER` (FR-025).
  - *Rejected:* the Claude Agent SDK as the app runtime. It runs Claude Code as a subprocess and needs a persistent container or sandbox, which doesn't fit plain Vercel functions (risk to M6). Claude Code stays our **build** tool.
  - *Why this is better here:* the confirmation gate (FR-010) lives in our own loop, where it's easy to see and test.
  - Loop limits: max 6 tool iterations, max tokens per request (PRD §8.1, LLM10).
- **ADR-004 Tools:** MCP server **in-process** via `@modelcontextprotocol/sdk` (no stdio child process). Each tool declares `risk: read | write`. Write tools are mocks labelled "simulated".
- **ADR-005 Graph tool:** three seed modes: node ID + hop limit, label/classification filter, relation type (FR-005b).
- **ADR-006 Orchestration:** on confirm, emit `access_request.submitted`. **Preferred:** a durable **Vercel Workflow** (`workflow` package, `withWorkflow` in `next.config.ts`). One hook per approver, raced against an SLA `sleep()`; one `"use step"` per transition writing an audit record (FR-024, FR-024a, FR-024b).
  - **Fallback:** in-process event bus + in-memory state machine with the same states. Switch to it if the workflow isn't working by **Sat 22:00 (M4)**.
  - Hooks are resumed only from the "Simulated approver" panel, never from agent tools.
  - Cost is cents (about 40 workflow events per request), and suspended runs use no compute.
  - The production equivalent is EventBridge + Step Functions callback tokens (PRD §10.3), and the hook-per-approver design maps one-to-one onto it.
- **Observability:** Langfuse for tracing; append-only `audit_log` table.
- Evals: TypeScript runner over the golden set, run in two modes (`baseline` = hybrid text retrieval without the graph; `graphrag` = hybrid text + graph traversal), executed in GitHub Actions with gating thresholds from spec §6

## Hard rules (from the constitution)
- Write tools (`create_access_request`, `create_onboarding_ticket`) execute only after an explicit **action-confirmation** event, enforced in code, not in the prompt. The copilot never records organisational approvals (REF-005).
- Router intent → route mapping is fixed by spec FR-005a. Don't invent new route names.
- Every answer returns citations, assumptions, gaps and a confidence level.
- Synthetic data only. Never commit `.env`. Redact PII in logs and traces.
- Scenario "today" is 2026-11-13 (matters for vendor assessment expiry).

## Scope guardrails
PoC, not a platform: no auth, no multi-tenancy, no real connectors. Feature freeze Sunday 12:00. Publishing beats polish.

## Commands
- `python3 scripts/validate_seed.py`: validate the fixtures (must pass)
- Add the build, dev, ingest and eval commands here once scaffolded.
