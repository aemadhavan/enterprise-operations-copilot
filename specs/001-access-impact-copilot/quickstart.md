# Quickstart and validation guide

How to run the copilot locally and prove each milestone works. Contracts: [http-api](./contracts/http-api.md), [mcp-tools](./contracts/mcp-tools.md), [answer-schema](./contracts/answer-schema.md). Data: [data-model](./data-model.md).

## Prerequisites
- Node.js 22, pnpm, Python 3
- A Neon project (`DATABASE_URL`) with the `vector` extension
- `ANTHROPIC_API_KEY` (or AWS credentials + `MODEL_PROVIDER=bedrock`), `VOYAGE_API_KEY`, Langfuse keys (`LANGFUSE_BASE_URL`, default `https://jp.cloud.langfuse.com`)
- After cloning: create `.specify/feature.json` (see CLAUDE.md) and copy `.env.example` to `.env.local` (gitignored). Next.js reads `.env.local` automatically; `ingest`, `db:migrate` and the eval scripts load it explicitly via `dotenv` with `path: '.env.local'`

## Setup
```bash
pnpm install
python scripts/validate_seed.py     # python3 on macOS/Linux; must print "All checks passed."
pnpm db:migrate
pnpm ingest                          # documents → chunks + embeddings; graph seed → nodes/edges
pnpm dev                             # http://localhost:3000
```

## Validation scenarios

| # | Milestone | Run | Expected outcome |
|---|---|---|---|
| 1 | M2 | `pnpm eval:fast --cases GS-001..GS-008,GS-018..GS-020` | recall@5 ≥ 90%; exit code 0 |
| 2 | M3 | `pnpm eval:fast --cases GS-009..GS-016,GS-021` | GS-009 graph path matches the seed README hero traversal; recall@5 reported for both modes |
| 3 | M3 | `pnpm eval:model --mode graphrag` | Route accuracy ≥ 85% over all 30 cases |
| 4 | M4 | `pnpm eval:fast --category tool_selection` | Confirmation compliance 100%: no execution without confirm; one execution plus `proposed`/`confirmed`/`executed` audit rows after confirm; a repeat confirm returns `idempotent_replay: true`; the hook guard rejects agent-context calls |
| 5 | M4 | `pnpm eval:model --cases GS-022..GS-030` | Tool correctness ≥ 90% (GS-022–025), safe behaviour 100% (GS-026–028), clarify on GS-029–030 |
| 6 | M5 | `pnpm eval:full --mode both` then `pnpm eval:model --runs 3` | Groundedness and citation accuracy ≥ 90%; graphrag ≥ baseline + 20 pts on multi_hop completeness (reported); variation table written to `evaluation/results/summary.md` |
| 7 | Unit | `pnpm test` | Risk labels (FR-003), confidence rule (FR-006), SoD warning (FR-023), policy checks, redaction (FR-017), recall@5 metric |

## Manual hero walkthrough (PRD §5)
1. Ask GS-001. The answer says 90 days, renewable once, with a POL-014 §3.4 chip and route `text`.
2. Ask GS-009. Route `graph_traversal`; four approvers in order; the evidence panel shows Atlas CRM → Customer PII (Restricted).
3. "I'm Tom Gallagher. Raise it for my contractor Alex Chen for 120 days." The 120-day request is blocked (POL-014 §3.4), the copilot proposes 90 days, and it asks for the justification. No draft card appears.
4. "90 days. Customer-churn analysis." A draft card appears with the SIMULATED badge and a separation-of-duties warning.
5. Submit. You get `AR-0001`, a timeline that reads Pending sponsor → … → Pending Privacy Officer, and audit rows. Click Submit again: same ID, no new execution.
6. Open `/approver` and approve the sponsor step. The timeline advances. With `SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY=60`, an untouched step records `sla_breached` after ~5 minutes.
7. Open the Langfuse trace for the turn. It shows route, retrievals, tool calls, tokens, cost and latency, and the PII is redacted.
