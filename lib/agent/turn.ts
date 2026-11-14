import { readFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";
import type { DraftRecord } from "@/lib/drafts/drafts";
import { createAgentClient, type McpToolClient } from "@/lib/mcp/client";
import { createMcpServer } from "@/lib/mcp/server";
import { proposeTools } from "@/lib/mcp/tools/propose";
import { readTools } from "@/lib/mcp/tools/read";
import { createClient, type ModelClient } from "@/lib/model";
import { costUsd } from "@/lib/model/pricing";
import { type LangfuseClientLike, recordTurnTrace } from "@/lib/observability/langfuse";
import { redact } from "@/lib/observability/redact";
import type { PolicyBreach } from "@/lib/policy/checks";
import { routeQuestion, type RouteDecision } from "@/lib/router";
import { computeConfidence, filterCitations, renderMarkdown, type RetrievedSet } from "./answer";
import { answerClarifyRoute } from "./clarify-route";
import { runAgentLoop, type ToolCallRecord } from "./loop";
import { answerRefuseRoute, REFUSE_EVIDENCE } from "./refuse-route";
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
  router_route?: Route;
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
  tool_calls: { name: string; input: unknown; ok: boolean; ms: number; output?: unknown }[];
  evidence_excerpts?: { doc_id: string; section: string; text: string }[];
  draft: DraftRecord | null;
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

let actionPrompt: string | undefined;
const loadActionPrompt = () =>
  (actionPrompt ??= readFileSync(path.join(process.cwd(), "lib/agent/prompts/action.md"), "utf8"));

export function parsePolicyCitationRef(raw: string): { doc_id: string; section: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^([A-Z]+-\d+(?:-\d+)?)\s*(?:§\s*(.+))?$/);
  if (!m) return null;
  return {
    doc_id: m[1],
    section: m[2]?.trim() || "*",
  };
}

/** Collect citable evidence and the graph path from this turn's tool results (Constitution I). */
export function evidenceFromToolCalls(calls: ToolCallRecord[]) {
  const retrieved: RetrievedSet = { chunks: [], edges: [] };
  const nodes = new Map<string, PathNode>();
  const edges = new Map<string, PathEdge>();
  const addEdge = (e: PathEdge) => {
    edges.set(`${e.source}|${e.relation}|${e.target}`, e);
    retrieved.edges.push(e);
  };
  const addCitationRef = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const parsed = parsePolicyCitationRef(raw);
    if (parsed) {
      retrieved.chunks.push({
        doc_id: parsed.doc_id,
        section: parsed.section,
        is_authoritative: true,
      });
    }
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
    } else if (c.name === "check_policy") {
      for (const cit of (out.citations ?? []) as unknown[]) addCitationRef(cit);
      for (const b of (out.breaches ?? []) as { citation?: string }[]) addCitationRef(b?.citation);
      for (const w of (out.warnings ?? []) as { citation?: string }[]) addCitationRef(w?.citation);
    } else if (c.name === "propose_access_request" || c.name === "propose_onboarding_ticket") {
      for (const cit of (out.policy_citations ?? []) as unknown[]) addCitationRef(cit);
      for (const b of (out.breaches ?? []) as { citation?: string }[]) addCitationRef(b?.citation);
      const vf = out.vendor_flag as { citation?: string } | undefined;
      if (vf?.citation) addCitationRef(vf.citation);
      const draft = out.draft as DraftRecord | undefined;
      if (draft) {
        for (const cit of draft.policy_citations ?? []) addCitationRef(cit);
        for (const step of draft.approval_chain ?? []) addCitationRef(step.source_doc);
        for (const w of draft.warnings ?? []) addCitationRef(w.citation);
        if (draft.payload.vendor_flag?.citation) addCitationRef(draft.payload.vendor_flag.citation);
      }
    }
  }
  return { retrieved, graph_path: { nodes: [...nodes.values()], edges: [...edges.values()] } };
}

interface BlockedActionInfo {
  breaches: PolicyBreach[];
  missing: string[];
}

function extractActionOutcome(
  calls: ToolCallRecord[],
  routerMissing: string[],
): { draft: DraftRecord | null; blocked: BlockedActionInfo | null } {
  let draft: DraftRecord | null = null;
  let breaches: PolicyBreach[] = [];
  const missingSet = new Set<string>(routerMissing);

  for (const c of calls) {
    if (!c.ok || !c.output || typeof c.output !== "object") continue;
    const out = c.output as Record<string, unknown>;
    if (c.name === "propose_access_request" || c.name === "propose_onboarding_ticket") {
      if (out.status === "drafted" && out.draft) {
        draft = out.draft as DraftRecord;
      } else if (out.status === "blocked") {
        draft = null;
        if (Array.isArray(out.breaches)) breaches = out.breaches as PolicyBreach[];
        if (Array.isArray(out.missing)) {
          for (const m of out.missing as string[]) missingSet.add(m);
        }
      } else if (out.status === "needs_fields" && Array.isArray(out.missing)) {
        for (const m of out.missing as string[]) missingSet.add(m);
      }
    } else if (c.name === "check_policy" && out.ok === false && Array.isArray(out.breaches)) {
      if (breaches.length === 0) breaches = out.breaches as PolicyBreach[];
    }
  }

  if (breaches.length > 0) {
    return { draft: null, blocked: { breaches, missing: [...missingSet] } };
  }
  return { draft, blocked: null };
}

const BREACH_KEYWORDS_RE =
  /\b(exceeds?|maximum|max\b|90[- ]day|not\s+(normally\s+)?permitted|expired|breach|violation|exception|renewable)\b/i;
const MISSING_KEYWORDS_RE =
  /\b(missing|provide|need\s+to\s+know|please\s+specify|required\s+fields?|sponsor|justification)\b/i;

/**
 * Enforce FR-011 / T053 on blocked action turns: policy breach and compliant alternative
 * are always reported BEFORE any missing-fields prompt, and no draft is returned.
 */
export function ensureBreachBeforeMissing(
  answer: FinalAnswer,
  blocked: BlockedActionInfo,
): FinalAnswer {
  const primaryBreach = blocked.breaches[0];
  const parsedCit = primaryBreach ? parsePolicyCitationRef(primaryBreach.citation) : null;
  const fallbackCitations: Citation[] = parsedCit
    ? [{ doc_id: parsedCit.doc_id, section: parsedCit.section }]
    : [];

  const breachClaims: FinalAnswer["claims"] = [];
  const missingClaims: FinalAnswer["claims"] = [];

  for (const c of answer.claims) {
    const isBreach = BREACH_KEYWORDS_RE.test(c.text);
    const isMissing = MISSING_KEYWORDS_RE.test(c.text) && !isBreach;
    if (isMissing) {
      missingClaims.push(c);
    } else {
      breachClaims.push(c);
    }
  }

  if (breachClaims.length === 0 && primaryBreach) {
    const limitDesc =
      primaryBreach.value !== undefined && primaryBreach.limit !== undefined
        ? `${primaryBreach.value} days exceeds the ${primaryBreach.limit}-day maximum (${primaryBreach.citation}).`
        : `Request violates policy rule ${primaryBreach.rule} (${primaryBreach.citation}).`;
    breachClaims.push({
      text: `${limitDesc} ${primaryBreach.alternative}`.trim(),
      key: true,
      citations: fallbackCitations,
      source_status: "effective_policy",
    });
  }

  const allText = [...breachClaims, ...missingClaims].map((c) => c.text).join(" ");
  if (
    blocked.missing.length > 0 &&
    missingClaims.length === 0 &&
    !blocked.missing.every((f) => new RegExp(`\\b${f}\\b`, "i").test(allText))
  ) {
    missingClaims.push({
      text: `Before a compliant draft can be created, please also provide the missing required fields: ${blocked.missing.join(", ")}.`,
      key: false,
      citations: breachClaims[0]?.citations?.length ? breachClaims[0].citations : fallbackCitations,
      source_status: "effective_policy",
    });
  }

  return {
    ...answer,
    behaviour: "answer",
    claims: [...breachClaims, ...missingClaims],
  };
}

const notYet = (_route: Route, why: string): FinalAnswer => ({
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
  refuseRoute?: typeof answerRefuseRoute;
  clarifyRoute?: typeof answerClarifyRoute;
  langfuse?: LangfuseClientLike;
}

/**
 * One chat turn (FR-004, FR-005, FR-009, FR-011, FR-012, US3, US4, US6):
 * redact → router → route → loop → post-processed answer.
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
  let evidence_excerpts: { doc_id: string; section: string; text: string }[] = [];
  let graph_path: TurnResult["graph_path"] = { nodes: [], edges: [] };
  let toolCalls: ToolCallRecord[] = [];
  let draft: DraftRecord | null = null;
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
    evidence_excerpts = r.retrieved.map((c) => ({
      doc_id: c.doc_id,
      section: c.section,
      text: c.text ?? "",
    }));
    if (r.usage) {
      cost += costUsd(config.ANTHROPIC_MODEL, r.usage);
      usage.input_tokens += r.usage.input_tokens;
      usage.output_tokens += r.usage.output_tokens;
    }
  } else if (route === "refuse") {
    const r = await (opts.refuseRoute ?? answerRefuseRoute)(question, {
      model: opts.agentModel,
      preRule: decision.pre_rule,
    });
    answer = r.answer;
    dropped = r.dropped_citations;
    retrieved = r.retrieved;
    evidence_excerpts = REFUSE_EVIDENCE.map((c) => ({
      doc_id: c.doc_id,
      section: c.section,
      text: c.text,
    }));
    if (r.usage) {
      cost += costUsd(config.ANTHROPIC_MODEL, r.usage);
      usage.input_tokens += r.usage.input_tokens;
      usage.output_tokens += r.usage.output_tokens;
    }
  } else if (route === "clarify") {
    const r = await (opts.clarifyRoute ?? answerClarifyRoute)(question, {
      model: opts.agentModel,
      missingFields: decision.router?.missing_fields,
    });
    answer = r.answer;
    dropped = r.dropped_citations;
    retrieved = r.retrieved;
    if (r.usage) {
      cost += costUsd(config.ANTHROPIC_MODEL, r.usage);
      usage.input_tokens += r.usage.input_tokens;
      usage.output_tokens += r.usage.output_tokens;
    }
  } else if (route === "graph_local" || route === "graph_traversal" || route === "action") {
    const isAction = route === "action";
    const isOnboardingAction =
      isAction && /\b(onboard(ing)?|onboarding\s+ticket|new\s+contractor)\b/i.test(question);
    const defaultTools = () => {
      if (!isAction) return createAgentClient(createMcpServer(readTools()));
      const activePropose = proposeTools().filter((t) =>
        isOnboardingAction
          ? t.name !== "propose_access_request"
          : t.name !== "propose_onboarding_ticket",
      );
      return createAgentClient(createMcpServer([...readTools(), ...activePropose]));
    };
    const client = await (opts.tools ?? defaultTools)();
    if (mode === "baseline") client.tools = client.tools.filter((t) => !GRAPH_TOOLS.has(t.name));
    try {
      const seeds = decision.entities.map((e) => `${e.id} (${e.label}: ${e.name})`).join("\n");
      const loop = await runAgentLoop({
        system: isAction ? loadActionPrompt() : loadGraphPrompt(),
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

      const outcome = isAction
        ? extractActionOutcome(loop.tool_calls, decision.router?.missing_fields ?? [])
        : { draft: null, blocked: null };
      draft = outcome.draft;

      if (loop.stop === "end_turn" && loop.text) {
        const filtered = filterCitations(FinalAnswer.parse(JSON.parse(loop.text)), retrieved);
        dropped = filtered.dropped;
        const { dropped: _d, ...rest } = filtered;
        void _d;
        answer = rest;
        if (outcome.blocked) {
          answer = ensureBreachBeforeMissing(answer, outcome.blocked);
        } else if (draft) {
          answer = { ...answer, behaviour: "draft" };
        } else if (answer.behaviour === "answer" && !answer.claims.some((c) => c.citations.length)) {
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
    const task = { clarify: "T052" }[route] ?? "M4";
    answer = notYet(route, `The ${route} route is not implemented in this build yet (${task}).`);
  }

  const citations = [
    ...new Map(
      answer.claims.flatMap((c) => c.citations).map((c) => [JSON.stringify(c), c]),
    ).values(),
  ];
  const confidence = computeConfidence(answer, retrieved);
  const latency_ms = Date.now() - t0;
  const cost_usd = Number(cost.toFixed(6));
  const formattedToolCalls = toolCalls.map(({ name, input, ok, ms }) => ({ name, input, ok, ms }));

  const trace = await recordTurnTrace({
    question,
    mode,
    intent: decision.intent,
    risk: decision.risk,
    route,
    retrievals: retrieved.chunks,
    graph_edges: graph_path.edges,
    tool_calls: formattedToolCalls,
    draft_ids: draft ? [draft.draft_id] : [],
    behaviour: answer.behaviour,
    confidence,
    citations,
    usage,
    cost_usd,
    latency_ms,
    client: opts.langfuse,
  });

  if (evidence_excerpts.length === 0 && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      if (!tc.ok || !tc.output || typeof tc.output !== "object") continue;
      const out = tc.output as Record<string, unknown>;
      if (tc.name === "search_documents" && Array.isArray(out.results)) {
        for (const r of out.results as { doc_id: string; section: string; text?: string }[]) {
          evidence_excerpts.push({
            doc_id: r.doc_id,
            section: r.section,
            text: r.text ?? "",
          });
        }
      } else if (tc.name === "get_section" && typeof out.doc_id === "string") {
        evidence_excerpts.push({
          doc_id: out.doc_id,
          section: String(out.section ?? ""),
          text: String(out.text ?? ""),
        });
      } else if (
        tc.name === "lookup_approvals" ||
        tc.name === "check_policy" ||
        tc.name === "propose_access_request" ||
        tc.name === "propose_onboarding_ticket"
      ) {
        const citedDocs = [
          ...((out.citations as string[] | undefined) ?? []),
          ...((out.policy_citations as string[] | undefined) ?? []),
          ...(((out.breaches as { citation?: string }[] | undefined) ?? []).map((b) => b.citation ?? "")),
          ...(((out.warnings as { citation?: string }[] | undefined) ?? []).map((w) => w.citation ?? "")),
        ].filter(Boolean);
        evidence_excerpts.push({
          doc_id: citedDocs.length > 0 ? citedDocs.join(", ") : `TOOL:${tc.name}`,
          section: tc.name,
          text: JSON.stringify(out),
        });
      }
    }
  }

  return {
    route,
    router_route: decision.route,
    intent: decision.intent,
    risk: decision.risk,
    mode,
    answer: {
      markdown: renderMarkdown(answer),
      claims: answer.claims,
      assumptions: answer.assumptions,
      gaps: answer.gaps,
      confidence,
      behaviour: answer.behaviour,
      legitimate_path: answer.legitimate_path,
      clarifying_question: answer.clarifying_question,
    },
    citations,
    graph_path,
    tool_calls: formattedToolCalls,
    evidence_excerpts,
    draft,
    entities: decision.entities,
    dropped_citations: dropped,
    latency_ms,
    cost_usd,
    usage,
    trace_id: trace.trace_id,
  };
}
