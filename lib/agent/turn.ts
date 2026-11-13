import { readFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { createAgentClient, type McpToolClient } from "@/lib/mcp/client";
import { createMcpServer } from "@/lib/mcp/server";
import { readTools } from "@/lib/mcp/tools/read";
import { createClient, type ModelClient } from "@/lib/model";
import { costUsd } from "@/lib/model/pricing";
import { redact } from "@/lib/observability/redact";
import { routeQuestion, type RouteDecision } from "@/lib/router";
import { computeConfidence, filterCitations, renderMarkdown, type RetrievedSet } from "./answer";
import { runAgentLoop, type ToolCallRecord } from "./loop";
import { FinalAnswer, jsonSchemaFor, type Citation, type Confidence, type Route } from "./schemas";
import { answerTextRoute } from "./text-route";

export type TurnMode = "graphrag" | "baseline";

interface PathNode {
  id: string;
  label: string;
  name: string;
  classification: string | null;
}
interface PathEdge {
  source: string;
  relation: string;
  target: string;
  condition: string | null;
  source_doc: string | null;
}

export interface TurnResult {
  route: Route;
  intent: string;
  risk: string;
  mode: TurnMode;
  answer: {
    markdown: string;
    claims: FinalAnswer["claims"];
    assumptions: string[];
    gaps: string[];
    confidence: Confidence;
    behaviour: FinalAnswer["behaviour"];
    legitimate_path: string | null;
    clarifying_question: string | null;
  };
  citations: Citation[];
  graph_path: { nodes: PathNode[]; edges: PathEdge[] };
  tool_calls: { name: string; input: unknown; ok: boolean; ms: number }[];
  draft: null;
  entities: RouteDecision["entities"];
  dropped_citations: number;
  latency_ms: number;
  cost_usd: number;
  usage: { input_tokens: number; output_tokens: number };
  trace_id: string | null;
}

/** Graph-route tools; `mode=baseline` removes the graph-backed ones (US6, SC-010). */
const GRAPH_TOOLS = new Set(["graph_query", "lookup_approvals"]);

let graphPrompt: string | undefined;
const loadGraphPrompt = () =>
  (graphPrompt ??= readFileSync(path.join(process.cwd(), "lib/agent/prompts/graph.md"), "utf8"));

/** Collect citable evidence and the graph path from this turn's tool results (Constitution I). */
export function evidenceFromToolCalls(calls: ToolCallRecord[]) {
  const retrieved: RetrievedSet = { chunks: [], edges: [] };
  const nodes = new Map<string, PathNode>();
  const edges = new Map<string, PathEdge>();
  const addEdge = (e: PathEdge) => {
    edges.set(`${e.source}|${e.relation}|${e.target}`, e);
    retrieved.edges.push(e);
  };
  for (const c of calls) {
    if (!c.ok) continue;
    const out = c.output as Record<string, unknown>;
    if (c.name === "search_documents") {
      for (const r of (out.results ?? []) as {
        doc_id: string;
        section: string;
        status: string;
      }[]) {
        retrieved.chunks.push({
          doc_id: r.doc_id,
          section: r.section,
          is_authoritative: r.status === "effective_policy",
        });
      }
    } else if (c.name === "get_section" && typeof out.doc_id === "string") {
      retrieved.chunks.push({
        doc_id: out.doc_id,
        section: String(out.section),
        is_authoritative: Boolean(out.is_authoritative),
      });
    } else if (c.name === "graph_query") {
      for (const n of (out.nodes ?? []) as PathNode[]) nodes.set(n.id, n);
      for (const e of (out.edges ?? []) as PathEdge[]) addEdge(e);
    } else if (c.name === "lookup_approvals") {
      for (const e of (out.evidence_edges ?? []) as PathEdge[]) addEdge(e);
    }
  }
  return { retrieved, graph_path: { nodes: [...nodes.values()], edges: [...edges.values()] } };
}

const notYet = (route: Route, why: string): FinalAnswer => ({
  behaviour: "state_gap",
  claims: [],
  assumptions: [],
  gaps: [why],
  clarifying_question: null,
  legitimate_path: null,
});

export interface TurnDeps {
  route?: (q: string) => Promise<RouteDecision>;
  agentModel?: Pick<ModelClient, "create" | "model">;
  tools?: () => Promise<McpToolClient>;
  textRoute?: typeof answerTextRoute;
}

/**
 * One chat turn (FR-004, FR-005, US6): redact → router → route → loop → post-processed answer.
 * Routes in this build: text, graph_local, graph_traversal. refuse / action / clarify arrive in
 * M4 (T051, T053, T052) and answer with a stated gap until then; no tool runs for them.
 */
export async function runTurn(
  message: string,
  opts: { mode?: TurnMode } & TurnDeps = {},
): Promise<TurnResult> {
  const t0 = Date.now();
  const mode = opts.mode ?? "graphrag";
  const question = redact(message);
  const config = getConfig();

  const decision = await (opts.route ?? ((q) => routeQuestion(q)))(question);
  let cost = decision.usage ? costUsd(config.ROUTER_MODEL, decision.usage) : 0;
  const usage = {
    input_tokens: decision.usage?.input_tokens ?? 0,
    output_tokens: decision.usage?.output_tokens ?? 0,
  };

  let route: Route = decision.route;
  // Baseline mode has no graph: graph routes fall back to hybrid text retrieval (US6).
  if (mode === "baseline" && (route === "graph_local" || route === "graph_traversal")) {
    route = "text";
  }

  let answer: FinalAnswer;
  let retrieved: RetrievedSet = { chunks: [], edges: [] };
  let graph_path: TurnResult["graph_path"] = { nodes: [], edges: [] };
  let toolCalls: ToolCallRecord[] = [];
  let dropped = 0;

  if (route === "text") {
    const r = await (opts.textRoute ?? answerTextRoute)(question);
    answer = r.answer;
    dropped = r.dropped_citations;
    retrieved = {
      chunks: r.retrieved.map((c) => ({
        doc_id: c.doc_id,
        section: c.section,
        is_authoritative: c.is_authoritative,
      })),
      edges: [],
    };
    if (r.usage) {
      cost += costUsd(config.ANTHROPIC_MODEL, r.usage);
      usage.input_tokens += r.usage.input_tokens;
      usage.output_tokens += r.usage.output_tokens;
    }
  } else if (route === "graph_local" || route === "graph_traversal") {
    const client = await (opts.tools ?? (() => createAgentClient(createMcpServer(readTools()))))();
    if (mode === "baseline") client.tools = client.tools.filter((t) => !GRAPH_TOOLS.has(t.name));
    try {
      const seeds = decision.entities.map((e) => `${e.id} (${e.label}: ${e.name})`).join("\n");
      const loop = await runAgentLoop({
        system: loadGraphPrompt(),
        messages: [
          {
            role: "user",
            content: `<resolved_entities>\n${seeds || "none"}\n</resolved_entities>\n\n<question>${question}</question>`,
          },
        ],
        tools: client,
        model: opts.agentModel ?? createClient("agent"),
        outputSchema: jsonSchemaFor(FinalAnswer),
      });
      toolCalls = loop.tool_calls;
      cost += loop.cost_usd;
      usage.input_tokens += loop.usage.input_tokens;
      usage.output_tokens += loop.usage.output_tokens;
      ({ retrieved, graph_path } = evidenceFromToolCalls(loop.tool_calls));

      if (loop.stop === "end_turn" && loop.text) {
        const filtered = filterCitations(FinalAnswer.parse(JSON.parse(loop.text)), retrieved);
        dropped = filtered.dropped;
        const { dropped: _d, ...rest } = filtered;
        void _d;
        answer = rest;
        if (answer.behaviour === "answer" && !answer.claims.some((c) => c.citations.length)) {
          answer = notYet(route, "No claim could be tied to retrieved evidence.");
        }
      } else {
        answer = notYet(
          route,
          loop.stop === "refusal"
            ? "The model declined to answer this question."
            : `The agent stopped before answering (${loop.stop}).`,
        );
      }
    } finally {
      await client.close();
    }
  } else {
    const task = { refuse: "T051", action: "T053", clarify: "T052" }[route] ?? "M4";
    answer = notYet(route, `The ${route} route is not implemented in this build yet (${task}).`);
  }

  const citations = [
    ...new Map(
      answer.claims.flatMap((c) => c.citations).map((c) => [JSON.stringify(c), c]),
    ).values(),
  ];
  return {
    route,
    intent: decision.intent,
    risk: decision.risk,
    mode,
    answer: {
      markdown: renderMarkdown(answer),
      claims: answer.claims,
      assumptions: answer.assumptions,
      gaps: answer.gaps,
      confidence: computeConfidence(answer, retrieved),
      behaviour: answer.behaviour,
      legitimate_path: answer.legitimate_path,
      clarifying_question: answer.clarifying_question,
    },
    citations,
    graph_path,
    tool_calls: toolCalls.map(({ name, input, ok, ms }) => ({ name, input, ok, ms })),
    draft: null,
    entities: decision.entities,
    dropped_citations: dropped,
    latency_ms: Date.now() - t0,
    cost_usd: Number(cost.toFixed(6)),
    usage,
    trace_id: null, // Langfuse arrives in T059
  };
}
