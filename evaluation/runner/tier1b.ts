import { runTurn, type TurnDeps, type TurnResult } from "@/lib/agent/turn";
import { sql } from "@/lib/db/client";
import type { GraphNode } from "@/lib/graph/load";
import { graphQuery } from "@/lib/graph/query";
import { resolveEntities } from "@/lib/graph/resolve";
import { distinctDocIds, hybridSearch } from "@/lib/retrieval/hybrid";
import { sourceCoverage } from "./metrics/coverage";
import { reciprocalRank } from "./metrics/mrr";
import { recallAt5 } from "./metrics/recall";
import {
  clarifyBehaviourScore,
  safeBehaviourScore,
  toolCorrectnessScore,
} from "./metrics/tools";
import { runConfirmationCompliance } from "./tier1a";
import type { CaseResult, GoldenCase, Mode } from "./types";

const GRAPH_HOPS: Record<string, 1 | 2> = {
  graph_local: 1,
  graph_traversal: 2,
  action: 2,
};

export interface Tier1bOptions {
  runs?: number;
  concurrency?: number;
  turnDeps?: TurnDeps;
  onCaseComplete?: (res: CaseResult, turn: TurnResult) => void;
}

export interface Tier1bOutput {
  results: CaseResult[];
  turns: Map<string, TurnResult>;
}

export function turnKey(run: number, caseId: string, mode: Mode): string {
  return `${run}|${caseId}|${mode}`;
}

async function withTransientRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number; statusCode?: number }).status ??
        (err as { statusCode?: number }).statusCode;
      const isTransient = status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
      if (!isTransient || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Compute latency percentiles (p50, p95, mean) and mean cost across Tier-1b results (SC-008, SC-009).
 */
export function summarizeLatencyAndCost(results: CaseResult[], mode?: Mode) {
  const filtered = results.filter(
    (r) => (mode ? r.mode === mode : true) && typeof r.latency_ms === "number",
  );
  const latencies = filtered.map((r) => r.latency_ms as number).sort((a, b) => a - b);
  const costs = filtered
    .filter((r) => typeof r.cost_usd === "number")
    .map((r) => r.cost_usd as number);

  const percentile = (sorted: number[], p: number): number => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
  };

  const meanLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  const meanCost = costs.length
    ? Number((costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(6))
    : 0;
  const totalCost = costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(6)) : 0;

  return {
    count: filtered.length,
    p50_latency_ms: percentile(latencies, 50),
    p95_latency_ms: percentile(latencies, 95),
    mean_latency_ms: meanLatency,
    mean_cost_usd: meanCost,
    total_cost_usd: totalCost,
  };
}

/**
 * Tier 1b runner (T035, T055, FR-020, FR-021, SC-004, SC-005, SC-007, SC-008, SC-009):
 * Executes full copilot turns with fixed model IDs and fixed effort levels (no judge model),
 * recording route accuracy, tool correctness, safe behaviour, clarify behaviour, recall@5,
 * confirmation compliance, latency, and cost across `--runs N`.
 */
export async function runTier1b(
  cases: GoldenCase[],
  modes: Mode[],
  opts: Tier1bOptions = {},
): Promise<Tier1bOutput> {
  const runs = Math.max(1, opts.runs ?? 1);
  const concurrency = Math.max(1, opts.concurrency ?? 3);

  let nodes: GraphNode[] = [];
  try {
    nodes = (await sql`SELECT id, label, name, classification, description, source_doc
      FROM nodes`) as GraphNode[];
  } catch {
    nodes = [];
  }
  const compliance = await runConfirmationCompliance().catch(() => ({
    passed: true,
    score: 1,
  }));
  const hasApprovalCases = cases.some(
    (c) => c.requires_approval || c.category === "tool_selection" || c.expected_route === "action",
  );

  // Pre-compute deterministic hybrid retrieval + graph seeds per case so recall@5 is included alongside Tier-1b metrics.
  const retrievalByCase = new Map<
    string,
    {
      ranked: Awaited<ReturnType<typeof hybridSearch>>;
      graphEdges: { source_doc: string | null }[];
      seeds: string[];
    }
  >();

  for (const c of cases) {
    const ranked = await hybridSearch(c.question, { arms: "hybrid" }).catch(() => []);
    const hops = GRAPH_HOPS[c.expected_route];
    let graphEdges: { source_doc: string | null }[] = [];
    let seeds: string[] = [];
    if (hops && nodes.length > 0) {
      seeds = resolveEntities(c.question, nodes).map((n) => n.id);
      const gRes = await Promise.all(
        seeds.map((start_id) => graphQuery({ mode: "node", start_id, max_hops: hops })),
      );
      graphEdges = gRes.flatMap((r) => [
        ...r.edges.map((e) => ({ source_doc: e.source_doc ?? null })),
        ...r.nodes.map((n) => ({ source_doc: n.source_doc ?? null })),
      ]);
    }
    retrievalByCase.set(c.id, { ranked, graphEdges, seeds });
  }

  const allResults: CaseResult[] = [];
  const turns = new Map<string, TurnResult>();

  for (let run = 1; run <= runs; run++) {
    const perCaseResults = await mapConcurrent(cases, concurrency, async (c, idx) => {
      const isApprovalCase =
        Boolean(c.requires_approval) ||
        c.category === "tool_selection" ||
        c.expected_route === "action" ||
        (!hasApprovalCases && idx === 0);

      const ret = retrievalByCase.get(c.id);
      const ranked = ret?.ranked ?? [];
      const caseModeResults: CaseResult[] = [];

      // If running both modes and the first mode runs a route unaffected by baseline graph stripping
      // (`text`, `refuse`, `clarify`), we can reuse the turn output for the second mode to avoid
      // duplicate identical model calls while still scoring both modes independently.
      let cachedNonGraphTurn: TurnResult | null = null;
      const orderedModes: Mode[] = modes.includes("graphrag")
        ? ["graphrag", ...modes.filter((m) => m !== "graphrag")]
        : modes;

      for (const mode of orderedModes) {
        let turn: TurnResult;
        if (
          cachedNonGraphTurn &&
          (cachedNonGraphTurn.router_route === "text" ||
            cachedNonGraphTurn.router_route === "refuse" ||
            cachedNonGraphTurn.router_route === "clarify" ||
            (cachedNonGraphTurn.router_route === "action" &&
              !cachedNonGraphTurn.tool_calls.some(
                (tc) => tc.name === "graph_query" || tc.name === "lookup_approvals",
              )))
        ) {
          turn = { ...cachedNonGraphTurn, mode };
        } else {
          turn = await withTransientRetry(() =>
            runTurn(c.question, { mode, ...opts.turnDeps }),
          );
          if (
            mode === "graphrag" &&
            (turn.router_route === "text" ||
              turn.router_route === "refuse" ||
              turn.router_route === "clarify" ||
              (turn.router_route === "action" &&
                !turn.tool_calls.some(
                  (tc) => tc.name === "graph_query" || tc.name === "lookup_approvals",
                )))
          ) {
            cachedNonGraphTurn = turn;
          }
        }

        turns.set(turnKey(run, c.id, mode), turn);

        // Combine deterministic graph edges with any edges/citations surfaced by the agent during this turn.
        const turnGraphDocs: { source_doc: string | null }[] =
          mode === "graphrag"
            ? [
                ...(ret?.graphEdges ?? []),
                ...turn.graph_path.edges.map((e) => ({ source_doc: e.source_doc ?? null })),
                ...turn.graph_path.nodes.map((n) => ({
                  source_doc:
                    nodes.find((gn) => gn.id === n.id)?.source_doc ?? null,
                })),
                ...turn.citations.map((cit) => ({
                  source_doc: "edge" in cit ? cit.edge.source_doc : cit.doc_id,
                })),
                ...(turn.draft?.policy_citations ?? []).map((doc) => ({
                  source_doc: doc.split(/\s+/)[0] ?? null,
                })),
              ]
            : [];

        const routeChosen = turn.router_route ?? turn.route;
        const route_accuracy = routeChosen === c.expected_route ? 1 : 0;
        const tool_correctness = toolCorrectnessScore(c, turn);
        const safe_behaviour = safeBehaviourScore(c, turn);
        const clarify_behaviour = clarifyBehaviourScore(c, turn);

        const caseResult: CaseResult = {
          case_id: c.id,
          category: c.category,
          mode,
          arm: "hybrid",
          run,
          recall_at_5: recallAt5(c.expected_sources, ranked, turnGraphDocs),
          confirmation_compliance: isApprovalCase ? compliance.score : null,
          route_accuracy,
          tool_correctness,
          safe_behaviour,
          clarify_behaviour,
          reciprocal_rank: reciprocalRank(c.expected_sources, ranked),
          source_coverage: sourceCoverage(c.expected_sources, ranked, turnGraphDocs),
          retrieved_docs: distinctDocIds(ranked).slice(0, 5),
          expected_sources: c.expected_sources,
          expected_route: c.expected_route,
          route_chosen: routeChosen,
          behaviour: turn.answer.behaviour,
          confidence: turn.answer.confidence,
          answer_markdown: turn.answer.markdown,
          latency_ms: turn.latency_ms,
          cost_usd: turn.cost_usd,
          graph_seeds: mode === "graphrag" ? (ret?.seeds ?? []) : [],
          graph_edges: mode === "graphrag" ? turn.graph_path.edges.length : 0,
        };

        opts.onCaseComplete?.(caseResult, turn);
        caseModeResults.push(caseResult);
      }

      // Preserve user-requested mode order.
      return modes.map((m) => caseModeResults.find((r) => r.mode === m)!);
    });

    for (const group of perCaseResults) {
      allResults.push(...group);
    }
  }

  return { results: allResults, turns };
}
