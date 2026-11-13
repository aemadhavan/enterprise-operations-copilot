import { spawnSync } from "node:child_process";
import { sql } from "@/lib/db/client";
import type { GraphNode } from "@/lib/graph/load";
import { graphQuery } from "@/lib/graph/query";
import { resolveEntities } from "@/lib/graph/resolve";
import { distinctDocIds, hybridSearch, type SearchArms } from "@/lib/retrieval/hybrid";
import { sourceCoverage } from "./metrics/coverage";
import { reciprocalRank } from "./metrics/mrr";
import { recallAt5 } from "./metrics/recall";
import type { CaseResult, GoldenCase, Mode } from "./types";

/** Fixture validator (Tier 1a always starts here). */
export function runValidator(): { ok: boolean; output: string } {
  const python = process.platform === "win32" ? "python" : "python3";
  const r = spawnSync(python, ["scripts/validate_seed.py"], { encoding: "utf8" });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

const GRAPH_HOPS: Record<string, 1 | 2> = { graph_local: 1, graph_traversal: 2 };

/**
 * Deterministic graph seeding for Tier 1a (no router, no model): resolve entities in the
 * question and run graph_query node mode from each, 1 hop for graph_local and 2 for
 * graph_traversal cases. Label/relation seed modes need the agent's choice, so corpus-wide
 * questions get only what entity seeds reach here.
 */
async function graphEdgesFor(c: GoldenCase, nodes: GraphNode[]) {
  const hops = GRAPH_HOPS[c.expected_route];
  if (!hops) return { edges: [], seeds: [] as string[] };
  const seeds = resolveEntities(c.question, nodes).map((n) => n.id);
  const results = await Promise.all(
    seeds.map((start_id) => graphQuery({ mode: "node", start_id, max_hops: hops })),
  );
  // Edges and nodes both carry source_doc; both count on graph routes (spec clarification).
  return { edges: results.flatMap((r) => [...r.edges, ...r.nodes]), seeds };
}

/**
 * Tier 1a retrieval: calls lib/retrieval and lib/graph directly, no chat model (FR-020, FR-021).
 * `baseline` = hybrid text only; `graphrag` = hybrid text + graph edges and nodes on graph-route cases.
 */
export async function runRetrieval(
  cases: GoldenCase[],
  modes: Mode[],
  arms: SearchArms[],
): Promise<CaseResult[]> {
  const nodes = (await sql`SELECT id, label, name, classification, description, source_doc
    FROM nodes`) as GraphNode[];
  const results: CaseResult[] = [];
  for (const c of cases) {
    for (const mode of modes) {
      for (const arm of arms) {
        const started = performance.now();
        const ranked = await hybridSearch(c.question, { arms: arm });
        const graph =
          mode === "graphrag" ? await graphEdgesFor(c, nodes) : { edges: [], seeds: [] };
        const edges = graph.edges;
        const latency_ms = Math.round(performance.now() - started);
        results.push({
          graph_seeds: graph.seeds,
          graph_edges: edges.length,
          case_id: c.id,
          mode,
          arm,
          recall_at_5: recallAt5(c.expected_sources, ranked, edges),
          reciprocal_rank: reciprocalRank(c.expected_sources, ranked),
          source_coverage: sourceCoverage(c.expected_sources, ranked, edges),
          retrieved_docs: distinctDocIds(ranked).slice(0, 5),
          expected_sources: c.expected_sources,
          latency_ms,
        });
      }
    }
  }
  return results;
}
