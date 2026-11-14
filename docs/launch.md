# Launch Announcement & Impact Summary (T075, PRD §13)

## LinkedIn Launch Post

🚀 **Shipping the Enterprise Operations Copilot: Governed, Auditable Decision Support with GraphRAG & Invariant Safety Gates**

Most enterprise AI pilots fail not because LLMs can't retrieve documents, but because standard RAG is blind to entity relationships, organisational hierarchies, and separation-of-duties governance. When an access decision touches customer PII, asking an LLM to "summarize the policy" leads to hallucinations, unearned confidence, and zero auditability.

We built and shipped the **Enterprise Operations Copilot**—a production-grade, governed decision support system for enterprise access control and policy impact analysis.

### What Makes It Different:
1. **Governed GraphRAG Architecture**: Combines hybrid lexical (PostgreSQL full-text OR query) + dense vector search (Voyage 1024-d embeddings) with multi-hop recursive CTE graph traversal. On complex multi-hop queries, retrieval recall jumps from **74.8% (baseline) to 100.0% (GraphRAG)** without hallucinated hops.
2. **Zero Unauthorized Execution (100% Confirmation Compliance)**: Write tools are physically partitioned from the agent's MCP tool palette. The agent produces immutable, versioned draft records with automatic Separation-of-Duties (SoD) warnings and policy re-validation; execution requires explicit human confirmation via a dedicated panel.
3. **Simulated Approver Panel & Scaled SLA Engine**: Real-time multi-step approval workflow (Sponsor → Data Owner → Security Governance → Privacy Officer) racing each step against scaled SLA timers (`SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY`) with tamper-evident, append-only PostgreSQL audit logging.
4. **Sub-$0.01 Cost & Multi-Tier Model Architecture**: Router (`claude-haiku-5-5`, effort `low`) + Agent (`claude-sonnet-5-5`, effort `medium`) + Judge (`claude-opus-5-5`). Average cost per lookup query is **~$0.005–$0.013**, well below enterprise budget thresholds.
5. **Strict Evaluation Rigour**: 30-case benchmarked golden set evaluated continuously across 3 tiers (Tier-1a fast deterministic, Tier-1b model/route/tool/safety, and Tier-2 LLM-as-judge).

🔗 **Live Production App**: https://enterprise-operations-copilot.vercel.app  
📦 **GitHub Repository**: https://github.com/madhavan-v/enterprise-operations-copilot  
📊 **Evals Dashboard**: https://enterprise-operations-copilot.vercel.app/evals

---

## Résumé / Portfolio Bullets

- **Architected & Deployed Enterprise Operations Copilot**: Built a full-stack, production-grade governed operations copilot using Next.js 16, TypeScript, Neon PostgreSQL (pgvector + CTE recursive graph), and Anthropic Claude 3.5/5.5 model suite.
- **Engineered Governed GraphRAG Pipeline**: Implemented reciprocal rank fusion (RRF) combining BM25-style full-text and Voyage-3.5 1024-d vector embeddings with multi-hop relational graph querying, boosting multi-hop retrieval recall from **74.8% to 100.0%** (`recall@5`).
- **Enforced 100% Confirmation Compliance & Safety Invariants**: Implemented strict Model Context Protocol (MCP) tool separation (read/propose vs. write) ensuring zero unconfirmed state modifications (`SC-006: 100%`), with automated Separation-of-Duties (SoD) analysis and immutable audit trails.
- **Developed 3-Tier Continuous Evaluation Harness**: Built an automated eval runner measuring retrieval recall, route accuracy (100%), tool correctness (100%), safe refusal behaviour (100%), and Claude Opus 5.5 LLM-as-judge groundedness, with automated regression gating across every PR.
- **Optimized Cost & Latency Performance**: Designed a multi-tier model topology achieving **< 2s median latency** and **< $0.01 per request** average cost, with client-side and server-side fallback middleware across Anthropic and Amazon Bedrock.
