# Friday night runbook (about 2 hours)

What's already done in this bundle:

| File | Purpose |
|---|---|
| `.specify/memory/constitution.md` | 8 non-negotiable principles (Spec Kit's constitution) |
| `docs/PRD.md` | End-to-end PRD: vision, hero journey/demo script, wireframes, NFRs (OWASP LLM), milestones, risks, RACI, launch |
| `CLAUDE.md` | Context Claude Code loads automatically, including stack decisions ADR-001 to ADR-006 |
| `PLAYBOOK.md` | How a team adds a governed workflow: the reusable asset and mentoring evidence |
| `specs/001-access-impact-copilot/spec.md` | User stories, 19 EARS requirements, success criteria |
| `data/raw/*.md` | 15 synthetic documents (policies, procedures, inventory, approval matrix, incidents, vendor register, meeting notes) |
| `data/graph_seed/*.csv` | 66 nodes / 121 edges, every one citing its `source_doc` |
| `evaluation/golden_set.jsonl` | 30 cases: 8 direct, 8 multi-hop, 5 grounding, 4 tool, 3 safety, 2 ambiguous |
| `scripts/validate_seed.py` | Consistency checks (run in CI before evals) |

## 1. Create the repo (10 min)
```bash
gh repo create enterprise-operations-copilot --public --clone
cd enterprise-operations-copilot
# copy this bundle's contents in, then:
python3 scripts/validate_seed.py   # should print "All checks passed."
git add . && git commit -m "Spec, constitution, synthetic KB, graph seed, golden set"
```

## 2. Initialise Spec Kit (15 min)
```bash
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git
specify init --here --integration claude
```
Check `specify --help` if your version's flags differ. If `init` overwrites `.specify/memory/constitution.md`, restore it with `git checkout -- .specify/memory/constitution.md`.

## 3. Load the spec into the Spec Kit flow (20 min)
In Claude Code:
1. `/speckit.constitution`: "Use the existing constitution.md as is; check it for consistency only."
2. `/speckit.specify`: "Access Impact Copilot. Use specs/001-access-impact-copilot/spec.md as the specification and keep its requirement IDs." If it creates a new feature folder, replace its `spec.md` with ours.
3. `/speckit.clarify`: answer the two open questions (defaults: in-chat approval buttons; a different judge model).

## 4. Read the data once yourself (30 min)
Skim the 15 docs and walk GS-009 through the graph by hand (see `data/graph_seed/README.md`). You'll demo and defend this, so you need to know it cold.

## 5. Lock the stack decision (10 min, recorded as ADR-001 in plan.md tomorrow)
Recommended: a single TypeScript repo, Next.js on Vercel, and Neon Postgres (pgvector + full-text search, with the graph as edge tables queried through recursive CTEs). The agent is a tool-use loop on the Anthropic SDK that can switch to Amazon Bedrock with one setting. The MCP server runs in-process, and tracing uses Langfuse. See ADR-001 to ADR-006 in `CLAUDE.md`.

Rejected alternatives:
- **Neo4j:** a second datastore that 66 nodes don't need.
- **Claude Agent SDK as the app runtime:** needs a container or sandbox, which risks the Vercel deploy.

**Optional tonight (15 min):** request access to a Claude model in the Bedrock console (region ap-southeast-2, Sydney). You can then run the evals on Bedrock on Sunday, which gives you genuine AWS evidence.

## Saturday starts with
`/speckit.plan` → `/speckit.tasks` → `/speckit.analyze` → `/speckit.implement`, one task at a time.
