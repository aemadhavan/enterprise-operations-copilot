# Engineering Playbook: adding a governed AI workflow

This repo is a **reusable pattern**, not a one-off chatbot. This playbook shows how an engineer (including one new to AI engineering) adds a new governed workflow, for example *"Raise a data-export request"* or *"Check whether a vendor can be onboarded"*, without weakening the guardrails.

Read the [constitution](.specify/memory/constitution.md) first. Every step below exists to satisfy one of its principles.

---

## The five steps

### 1. Specify the behaviour before writing code (Constitution VI)
- Add a user story with Given/When/Then scenarios to the feature spec, or create a new spec with `/speckit.specify`.
- Write requirements in EARS form: *When …, the system shall …* and *If …, then the system shall …*.
- Decide the intent and route, and add them to the router table (spec FR-005a) if they're new.

**Review question:** *Can someone else build this from the spec alone, without asking you?*

### 2. Write the golden cases first (Constitution III)
Add at least:
- 2 happy-path cases
- 1 policy-breach case (`flag_and_propose`)
- 1 unsafe or pressure case (`refuse`)
- 1 ambiguous case (`clarify`)

Then run `python3 scripts/validate_seed.py`.

**Review question:** *Would these cases fail if the feature were wrong in the way you're most worried about?*

### 3. Model the knowledge (Constitution I)
- New facts go into `data/raw/` as documents with frontmatter, and into the graph as nodes and edges that cite a `source_doc`.
- Put conditional rules in an edge's `condition`, not in the prompt.
- Prefer one clearly owned source over duplicating a fact across documents.

**Review question:** *If this fact changes, how many places need editing? It should be one.*

### 4. Add tools with the right risk level (Constitution II, V)
- Pick one of three risk levels:
  - `read`: no side effects; runs freely in the agent loop.
  - `propose`: may only create or supersede **draft** rows; no business record changes; allowed in the agent loop. Use it for anything the agent prepares for a human to submit.
  - `write`: changes business records; callable **only** from the confirmation route, never from the agent loop. The agent's MCP client allow-lists `read` + `propose`.
- Write tools must:
  - declare `risk: "write"`;
  - validate their arguments against a schema;
  - run only after an action-confirmation event (enforced in code);
  - write `proposed`, `confirmed` and `executed` audit events;
  - emit a domain event if a downstream workflow follows (FR-024). Human approvals in that workflow are durable hooks resumed by people, never by the agent (FR-024a).
- Give every tool the narrowest input it needs. No free-text "do anything" parameters.

**Review question:** *If a prompt injection fully controlled the model, what's the worst this tool could do?*

### 5. Prove it, then ship it (Constitution III, IV, VIII)
1. Run `eval:fast` for the new cases on both providers if you can (`MODEL_PROVIDER=anthropic`, then `bedrock`).
2. Run `eval:full` before merging.
3. Check one trace end to end in Langfuse.
4. Update `docs/evaluation-results.md`, including anything that failed or that the baseline did better.

**Review question:** *Would you be comfortable showing these numbers to the security team?*

---

## Pull request checklist
- [ ] Spec updated; requirement IDs referenced in commits
- [ ] Golden cases added; validator passes
- [ ] No new write path without a confirmation gate and audit events
- [ ] Tier-1 evals green; no previously passing case now failing
- [ ] Trace reviewed; no PII in logs
- [ ] Limitations noted honestly

## Pairing and review norms
- **Pair on step 2.** Writing golden cases together is the fastest way to agree what "correct" means.
- **Review the spec diff before the code diff.** Most defects are cheaper to catch there.
- **Blameless eval failures.** A failing case is information, not a mistake to hide.
- **ADRs for any choice a newcomer would question.** Keep them to one paragraph: context, decision, alternative rejected and why.

## Anti-patterns
| Don't | Do instead |
|---|---|
| Put approval logic in the system prompt | Enforce it in code; the prompt only explains it |
| Tune prompts until one demo question works | Add the question to the golden set and tune against all cases |
| Hide low scores | Publish them with the reason and the next step |
| Let the model choose between free-form tools | Use a fixed router map and narrow tool schemas |
| Copy policy text into prompts | Retrieve it and cite it |
