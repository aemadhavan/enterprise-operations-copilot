# Phase 0 Research: Access Impact Copilot

Each item records a **Decision**, its **Rationale**, and the **Alternatives considered**. Model and API facts come from the Claude API reference bundled with Claude Code (cached 2026-11-03). Re-check them against the live docs before M2.

## R-01 Model IDs and providers (FR-025)
- **Decision (model tiering, ADR-010):** Router `claude-haiku-5-5` (`ROUTER_MODEL`, effort `low`). Agent and answers `claude-sonnet-5-5` (`ANTHROPIC_MODEL`, effort `medium`, set explicitly; the Sonnet 5.5 default is `high`). Eval judge `claude-opus-5-5` (`JUDGE_MODEL`): different from the copilot's model and stronger. On Bedrock: `anthropic.claude-haiku-5-5` (`BEDROCK_ROUTER_MODEL_ID`) and `anthropic.claude-sonnet-5-5` (`BEDROCK_MODEL_ID`), using `AnthropicBedrockMantle` from `@anthropic-ai/bedrock-sdk` with `awsRegion` set. Every model ID and effort level is recorded in every results file.
- **Rationale:** Matching the model to the job. Routing is a small structured task, so the fastest and cheapest model helps p95. Sonnet is strong at tool use at about half Opus's price. The judge runs only in Tier 2 (~60 calls per run), so a stronger judge costs little. The Mantle client exposes the same `messages.create` surface, so the loop runs unchanged on either provider.
- **Alternatives:** Opus everywhere, rejected (≈2× cost, over the $0.02 target; slower routing). Same model as judge, rejected (self-grading bias). The legacy `AnthropicBedrock` (InvokeModel) client, not preferred for new code.
- **Notes:** Haiku 5.5 has no server-side refusal fallback; a router refusal maps to `unsafe` → `refuse`, which is the safe default. Sonnet 5.5 fallbacks use `fallbacks: "default"`. **Open:** confirm both model IDs are available on Bedrock in ap-southeast-2; if not, use a cross-region inference profile and record it.

## R-02 Cost estimate (PRD §8.2, SC-009)
- **Decision:** Target ≤ US$0.02/request (provisional), measured at M5. Prompt caching on each model's static prefix (tools → system prompt). Caches are per model, so the router and agent each cache their own prefix.
- **Estimate** (list prices; assumes ~6k input and ~1k output tokens for a graph turn across 2–3 loop iterations, ~4k / 0.5k for a lookup, and ~1.5k / 0.15k for the router; about 4k of each agent prefix cached at $0.10/MTok):

  | Component | Model | Uncached | With caching |
  |---|---|---|---|
  | Router | Haiku 5.5 ($0.10 / $0.50) | ≈ $0.0002 | ≈ $0.0002 |
  | Lookup answer (`text`) | Sonnet 5.5 ($2 / $10) | ≈ $0.013 | ≈ $0.006 |
  | Graph answer (`graph_*`) | Sonnet 5.5 | ≈ $0.022 | ≈ $0.015 |
  | **Per request, mixed** | | ≈ $0.013–0.022 | **≈ $0.006–0.015** |
  | Tier 2 judge run | Opus 5.5 ($4 / $20), ~60 calls × ~4k / 0.5k (×2 modes) | ≈ $1.6 per mode | ≈ $1.6–3.2 per run |

  The earlier Opus-everywhere estimate was ≈ $0.03–0.05 per graph request uncached.
- **Rationale:** The tiering in R-01 brings cost back under target with headroom. Embedding calls (Voyage) add well under $0.0001 per query.
- **Alternatives:** Opus everywhere (rejected, above). Router as a keyword rule set with no model (rejected: too brittle for `entity` vs `impact`).

## R-03 Determinism for Tier 1b (FR-020, FR-021)
- **Decision (approved 2026-11-13):** Send no sampling parameters. Pin every model ID and set `output_config.effort` explicitly (router `low`, answers `medium`, judge `medium`). Use strict JSON schemas for the router, answer and judge. Run Tier 1b 3 times at M5 and report min/max/mean: the variation is measured rather than assumed to be zero.
- **Rationale:** Opus 5.5, Sonnet 5.5 and Haiku 5.5 reject non-default `temperature`/`top_p`/`top_k` with a 400, and from API version `2026-10-21` every model does. "Temperature 0" in the spec can't be implemented.
- **Done:** spec FR-020/FR-021 and §6, `evaluation/README.md`, the PRD M3 row and CLAUDE.md amended.

## R-04 Router output (FR-003, FR-005a)
- **Decision:** A single `messages.create` call with `output_config.format` set to a JSON schema: `{intent, risk, entities[], missing_fields[], rationale}`. Deterministic pre-rules come first: obvious injection or bypass phrases → `unsafe`. Risk is then normalised in code: `action`/`unsafe` → high, and a Restricted entity → high, checked against the graph. This matches the FR-003 rule exactly and is unit-tested.
- **Rationale:** Forced `tool_choice` (`any`/`tool`) returns 400 on Opus 5.5 and Sonnet 5.5. Structured outputs guarantee the shape. Computing risk in code keeps it testable without the model.
- **Alternatives:** Forced tool call (not possible); keyword router (too brittle for `entity` vs `impact`).

## R-05 Agent loop (ADR-003, LLM10)
- **Decision:** A manual loop: at most 6 iterations, `max_tokens` 16000 non-streaming (with streaming for the chat UI), adaptive thinking (the default on Opus 5.5; it can't be disabled), parallel tool results returned in a single user message, and `strict: true` on every tool schema. Check `stop_reason` for `refusal`. On the Anthropic API, enable server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`); on Bedrock use `BetaRefusalFallbackMiddleware`. Tool inputs are validated with Zod again before any call (LLM05).
- **Rationale:** The confirmation gate is easy to see in our own loop. Fallbacks keep a safety-classifier false positive from breaking the demo.
- **Alternatives:** The SDK Tool Runner, which is fine but hides the gate inside hooks.

## R-06 Answer structure and confidence (FR-006, clarification 3)
- **Decision:** The final turn returns JSON through `output_config.format`: `claims[] {text, citations[] {doc_id, section | edge}, source_status}`, `assumptions[]`, `gaps[]`, `behaviour` (`answer|state_gap|clarify|refuse|draft`). Code computes confidence (high/medium/low) and renders Markdown, which is sanitised. Citations are checked in code against the retrieved set; a citation that wasn't retrieved downgrades the claim to uncited.
- **Rationale:** Constitution I. Native API citations are incompatible with `output_config.format`, so we cite in our own schema.
- **Alternatives:** API `citations` on document blocks, which can't be combined with structured outputs and cover text only (no graph edges).

## R-07 Chunking and hybrid retrieval (FR-001, FR-004, SC-010)
- **Decision:** Chunk documents by Markdown heading (`##`/`###`), carrying `doc_id`, `section`, `version`, `effective_date`, `owner` and `doc_type` from the front matter. **Clause-level chunks:** a numbered clause bullet (`- **3.4** ...`) becomes its own chunk with section `3. Requirements > 3.4`, so a citation like "POL-014 §3.4" maps to exactly one chunk; text under the `#` title before the first `##` (e.g. the REF-004 control table) is a chunk whose section is the title; each row of a Markdown table becomes its own chunk (header row kept for context) with section `<heading path> > <first cell>`, e.g. `Control Catalogue > CTL-08`, so a short row is not outranked by a long table and controls, systems and roles can be cited individually; the synthetic-document banner is dropped. Each chunk is embedded as `title > section` plus its text. Full-text retrieval uses an **OR query over the meaningful words**: `to_tsquery('english', replace(plainto_tsquery('english', $q)::text, ' & ', ' | '))` (stop words removed and stemmed by `plainto_tsquery`, then AND turned into OR), ranked with `ts_rank_cd(tsv, q, 2)` (normalisation 2 divides by chunk length, so long chunks that repeat common words don't win), top 20. Vector retrieval is pgvector cosine, top 20. The two lists are fused with reciprocal rank fusion (k = 60). Results are deduplicated to distinct `doc_id` for the top 5 (clarification 1). There's no reranker in the MVP.
- **Rationale:** Sections match how citations are written ("POL-014 §3.4"). RRF needs no score calibration. 150 chunks need no ANN tuning, but we still add an HNSW index.
- **Changed 2026-11-14:** the first version used `websearch_to_tsquery('english')`, which ANDs every term, so whole natural-language questions matched no chunk and hybrid search was vector-only. OR semantics let `ts_rank_cd` rank by how many terms match and how close they are. Without length normalisation the long REF-003/REF-004 tables outranked POL-014 §3.4 for GS-001; with it, a single-chunk table lost to short chunks for `CTL-08`. Row-level table chunks plus normalisation 2 fix both.
- **Alternatives:** `websearch_to_tsquery` (AND semantics; see above); fixed-size token windows (they break section citations); a cross-encoder reranker (deferred: add only if recall@5 < 90% at M2).

## R-08 Embeddings (ADR-007)
- **Decision:** Voyage `voyage-3.5` at 1024 dimensions, `input_type` = `document` or `query`. The Bedrock alternative is `amazon.titan-embed-text-v2:0` at 1024 dimensions. The index stores `embedding_model`, and ingestion fails if it differs from the configured model.
- **Rationale:** Both support 1024 dimensions, so the schema doesn't change if we switch (a re-index is still required).
- **Alternatives:** OpenAI embeddings, which would add a third vendor.

## R-09 Graph traversal (FR-002, FR-005b)
- **Decision:** `graph_query(mode, …)` uses one of three parameterised SQL templates: (1) a recursive CTE from `start_id` up to `max_hops` (≤ 4, default 2), with an optional relation allow-list; (2) a label filter with optional `classification` or edge `condition`; (3) a relation filter (e.g. all `led_to` edges). Each returns `{nodes, edges[] {source, relation, target, condition, source_doc}}`. Data-owner approval is resolved through the system's `data_owner` edge in code (`lib/policy/approvals.ts`), not by the model. **Control evidence expansion (2026-11-14):** in every mode, when the result contains a `Control` node, its `implemented_by` edges are added one step further, regardless of `max_hops` (which stays 2 by default otherwise), so a control reached at the hop limit still brings in the procedure that carries it out (e.g. CTL-07 → PROC-REVIEW, PRC-019). Found by GS-009.
- **Rationale:** Deterministic, cheap, and checked in Tier 1a against the GS-009 path from the seed README.
- **Alternatives:** Letting the model write SQL (unsafe).

## R-10 Approval workflow (FR-024, FR-024a/b, ADR-006)
- **Decision:** `approvalWorkflow(requestId, chain, slaDays)` uses `"use workflow"`. For each approver in PRC-012 §3 order, it creates a hook (token `${requestId}:${role}`) and races `Promise.race([hook, sleep(scaledSla)])`. Each transition is a `"use step"` that writes `approval_steps` and an `audit_log` row. Hooks are resumed only by `/api/simulated-approver`, which requires an `x-approver-panel` origin check and rejects requests carrying the agent's tool-context marker. The engine sits behind `ApprovalEngine` (`start`, `status`, `resume`) so `APPROVAL_ENGINE=in-memory` swaps the implementation.
- **Rationale:** Matches ADR-006 and maps one-to-one onto Step Functions task tokens.
- **Time-box:** If it isn't working by Sat 22:00, switch to in-memory (PRD cut line).
- **T050 Checkpoint Decision (2026-11-14):** Verified the Vercel Workflow SDK API (`"use workflow"`, `"use step"`, `createHook({ token: "${requestId}:${role}" })`, `resumeHook`, `sleep`, `withWorkflow`) and implemented `lib/workflow/approval.workflow.ts`. We keep `APPROVAL_ENGINE=in-memory` as the default runtime engine in `.env.example` and production so that Vitest integration tests (`T038–T040`), scaled SLA timers (`SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY`), and the single-region demo run without requiring the `withWorkflow` Next.js build wrapper or external Workflow World storage, while preserving Postgres persistence of `approval_steps` and `audit_log` on every transition.

## R-11 Observability and redaction (FR-016, FR-017)
- **Decision:** Langfuse SDK (`LANGFUSE_BASE_URL`, default `https://jp.cloud.langfuse.com`) with one trace per chat turn, spans for router, retrieval, graph, each tool and the answer, plus generation records with token usage and a cost computed from a price table in config. `redact()` runs before every trace or log write. Regex covers email, phone (AU and international) and ID-like strings (`\b[A-Z]{2,5}-?\d{4,}\b`, 13–19 digit card-like numbers, and the AR-/TKT- patterns, which are allow-listed). Name detection (Should) uses an allow-list of graph `Person` names, and redacts capitalised name pairs not on that list.
- **Rationale:** Constitution IV/V. Regex is deterministic and unit-testable.

## R-12 Eval runner (FR-018–FR-022)
- **Decision:** `pnpm eval:fast|eval:model|eval:full --mode baseline|graphrag|both --cases GS-001..GS-008 --category multi_hop --runs 3`. 1a calls `lib/` with no model client (retrieval, graph, the gate and the hook guard driven by fixtures). 1b runs the full turn. 2 adds judge prompts from `evaluation/judges/*.md` (versioned). Output goes to `evaluation/results/<ts>-<tier>-<mode>.jsonl` and `summary.md`. The exit code is non-zero if a milestone-gated metric is below threshold. A "regression guard" compares per-case pass/fail against `evaluation/results/last-pass.json`.
- **Note:** 1a recall@5 needs query embeddings, which come from the embedding API, not the chat model. 1a therefore makes embedding calls but no chat-model calls. Cached query embeddings (`evaluation/cache/`) make CI runs free after the first.

## R-13 CI (FR-019)
- **Decision:** `eval-fast.yml` runs on every push: validator, `tsc`, Vitest, migrations against a Neon branch, ingest, Tier 1a. `eval-pr.yml` runs on PRs to `main`: Tier 1b + Tier 2, with secrets from GitHub Actions. It uses a Neon branch per run (created and then deleted) so CI never touches the demo database.
