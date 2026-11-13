# Enterprise Operations Copilot — Constitution

**Version:** 1.1.1 (PATCH: III wording split into Tier 1a / Tier 1b; 1.1.0 added continuous-evaluation rules to III) · **Ratified:** 2026-11-13 · **Applies to:** every spec, plan, task and line of code in this repository, whether written by a human or an AI coding agent.

These principles are non-negotiable. If a spec, plan or task conflicts with them, the constitution wins and the conflicting artefact is changed first.

---

## I. Grounded or Silent

- Every factual claim in a copilot answer MUST cite at least one retrievable source (document ID + section, or graph edge with its `source_doc`).
- If the evidence is missing, contradictory or out of date, the copilot MUST say so and name the gap. It MUST NOT guess.
- Proposals, drafts and meeting notes MUST NOT be presented as policy in force. Effective-dated policy always outranks discussion material.

## II. Human-in-the-Loop for Every Write

- Read tools (search, graph query, approval lookup) may run autonomously.
- Every write or state-changing tool (creating requests, tickets or records) MUST stop at an explicit human approval gate. Approval is enforced in deterministic code, never by prompt instructions alone.
- The copilot MUST NOT help bypass an organisational approval, even when asked to, and MUST NOT execute a request that breaches policy (e.g. duration over the allowed maximum). It flags the breach and proposes a compliant alternative.

## III. Evals Are the Acceptance Tests

- The golden set (`evaluation/golden_set.jsonl`) is the executable form of the spec's success criteria.
- Evals run in CI on every push to `main` and every pull request. A merge that drops any gated metric below its threshold fails the build.
- A new capability is not "done" until it has golden cases that cover it.
- Evaluation starts as soon as the first retrieval code exists (M2), not at the end. Tier-1a deterministic checks run after every implemented task; Tier-1b model-in-loop checks run before each milestone; judge-scored Tier-2 checks are added at feature freeze.
- No new task starts while a previously passing golden case is failing.

## IV. Observable by Default

- Every request produces a trace covering: intent and risk classification, route chosen, retrieval results, tool calls, approval decisions, final answer, latency, token usage and estimated cost.
- Every approval decision (approved, rejected, expired) is written to an append-only audit log.

## V. Least Privilege and Data Minimisation

- Only synthetic data is committed. No client, employer or personal data, ever.
- Secrets live in environment variables. `.env.example` is committed; `.env` is never committed.
- Logs and traces pass through PII redaction before they are stored.
- Each tool declares its risk level (`read` | `write`) and the roles allowed to call it.

## VI. The Spec Is the Source of Truth

- Work flows spec → plan → tasks → implementation → evaluation.
- When behaviour needs to change, change the spec (and golden set) first, then regenerate or modify code.
- Every task traces back to a functional requirement ID (`FR-xxx`), and every requirement to at least one golden case or test.

## VII. Simplicity Over Platform

- This is a PoC. Prefer the fewest moving parts that prove the idea: one repository, one database where possible, mock integrations clearly labelled as simulated.
- Architectural choices are recorded as short ADRs in the plan, each with the alternative rejected and why.

## VIII. Honest Reporting

- Published results include failures, limitations and the cases where Baseline RAG beats GraphRAG.
- Metrics are reported as measured, with run date, model and dataset version. No cherry-picking.

---

## Governance

- Amendments require a PR that updates this file, bumps the version (semantic versioning: MAJOR for removed or redefined principles, MINOR for new principles, PATCH for wording) and notes the impact on existing specs.
- `/speckit.analyze` (or a manual review) checks spec, plan and tasks against this constitution before implementation starts.
