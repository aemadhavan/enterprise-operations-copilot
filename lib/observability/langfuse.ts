import { randomUUID } from "node:crypto";
import type { Citation, Confidence, FinalAnswer, Route } from "@/lib/agent/schemas";
import { getConfig } from "@/lib/config";
import { costUsd } from "@/lib/model/pricing";
import { redact, redactDeep } from "./redact";

export interface TraceRetrieval {
  doc_id: string;
  section: string;
  is_authoritative: boolean;
}

export interface TraceGraphEdge {
  source: string;
  relation: string;
  target: string;
  condition: string | null;
  source_doc: string | null;
}

export interface TraceToolCall {
  name: string;
  input: unknown;
  ok: boolean;
  ms: number;
}

export interface ApprovalDecisionTrace {
  type: "confirmation" | "cancellation" | "approver_step";
  draft_id: string | null;
  request_id: string | null;
  role: string | null;
  actor: string;
  decision: "confirmed" | "cancelled" | "approve" | "reject";
  sla_breached: boolean;
  at: string;
  trace_id: string;
}

export interface TurnTracePayload {
  trace_id: string;
  question: string;
  mode: "graphrag" | "baseline";
  intent: string;
  risk: string;
  route: Route;
  retrievals: TraceRetrieval[];
  graph_edges: TraceGraphEdge[];
  tool_calls: TraceToolCall[];
  draft_ids: string[];
  approval_decisions: ApprovalDecisionTrace[];
  behaviour: FinalAnswer["behaviour"];
  confidence: Confidence;
  citations: Citation[];
  tokens: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  cost_usd: number;
  latency_ms: number;
  created_at: string;
}

export interface LangfuseClientLike {
  trace(payload: TurnTracePayload): void | Promise<void>;
  event?(payload: ApprovalDecisionTrace): void | Promise<void>;
  flush?(): void | Promise<void>;
}

/** In-memory store linking drafts/requests to turn traces and recording decisions. */
const tracesById = new Map<string, TurnTracePayload>();
const traceIdByDraftId = new Map<string, string>();
const traceIdByRequestId = new Map<string, string>();

let customClient: LangfuseClientLike | null = null;

/** Inject a fake or custom Langfuse client (used in unit tests). */
export function setLangfuseClient(client: LangfuseClientLike | null): void {
  customClient = client;
}

export function resetTraceStore(): void {
  tracesById.clear();
  traceIdByDraftId.clear();
  traceIdByRequestId.clear();
}

export function getRecordedTrace(traceId: string): TurnTracePayload | undefined {
  return tracesById.get(traceId);
}

export function getTraceIdForDraft(draftId: string): string | undefined {
  return traceIdByDraftId.get(draftId);
}

export function getTraceIdForRequest(requestId: string): string | undefined {
  return traceIdByRequestId.get(requestId);
}

function createHttpLangfuseClient(): LangfuseClientLike {
  return {
    async trace(payload: TurnTracePayload) {
      const cfg = getConfig();
      if (!cfg.LANGFUSE_PUBLIC_KEY || !cfg.LANGFUSE_SECRET_KEY) return;
      const auth = Buffer.from(`${cfg.LANGFUSE_PUBLIC_KEY}:${cfg.LANGFUSE_SECRET_KEY}`).toString(
        "base64",
      );
      try {
        await fetch(`${cfg.LANGFUSE_BASE_URL.replace(/\/$/, "")}/api/public/ingestion`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({
            batch: [
              {
                id: payload.trace_id,
                type: "trace-create",
                timestamp: payload.created_at,
                body: {
                  id: payload.trace_id,
                  name: `turn:${payload.route}`,
                  input: payload.question,
                  metadata: payload,
                },
              },
            ],
          }),
        });
      } catch {
        // Observability must never break user turns when remote endpoint is unreachable.
      }
    },
    async event(decision: ApprovalDecisionTrace) {
      const cfg = getConfig();
      if (!cfg.LANGFUSE_PUBLIC_KEY || !cfg.LANGFUSE_SECRET_KEY) return;
      const auth = Buffer.from(`${cfg.LANGFUSE_PUBLIC_KEY}:${cfg.LANGFUSE_SECRET_KEY}`).toString(
        "base64",
      );
      try {
        await fetch(`${cfg.LANGFUSE_BASE_URL.replace(/\/$/, "")}/api/public/ingestion`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Basic ${auth}`,
          },
          body: JSON.stringify({
            batch: [
              {
                id: randomUUID(),
                type: "event-create",
                timestamp: decision.at,
                body: {
                  traceId: decision.trace_id,
                  name: `approval:${decision.type}:${decision.decision}`,
                  metadata: decision,
                },
              },
            ],
          }),
        });
      } catch {
        // Non-blocking telemetry.
      }
    },
  };
}

function activeClient(): LangfuseClientLike {
  return customClient ?? createHttpLangfuseClient();
}

export interface RecordTurnTraceInput {
  trace_id?: string;
  question: string;
  mode: "graphrag" | "baseline";
  intent: string;
  risk: string;
  route: Route;
  retrievals: TraceRetrieval[];
  graph_edges: TraceGraphEdge[];
  tool_calls: TraceToolCall[];
  draft_ids: string[];
  approval_decisions?: ApprovalDecisionTrace[];
  behaviour: FinalAnswer["behaviour"];
  confidence: Confidence;
  citations: Citation[];
  usage: { input_tokens: number; output_tokens: number };
  cost_usd?: number;
  model_for_pricing?: string;
  latency_ms: number;
  client?: LangfuseClientLike;
}

/**
 * Redacts all strings/args and records a per-turn trace (FR-016, FR-017, Constitution IV).
 */
export async function recordTurnTrace(input: RecordTurnTraceInput): Promise<TurnTracePayload> {
  const trace_id = input.trace_id ?? randomUUID();
  const cfg = getConfig();
  const computedCost =
    input.cost_usd !== undefined
      ? Number(input.cost_usd.toFixed(6))
      : Number(costUsd(input.model_for_pricing ?? cfg.ANTHROPIC_MODEL, input.usage).toFixed(6));

  const payload: TurnTracePayload = {
    trace_id,
    question: redact(input.question),
    mode: input.mode,
    intent: redact(input.intent),
    risk: redact(input.risk),
    route: input.route,
    retrievals: redactDeep(input.retrievals),
    graph_edges: redactDeep(input.graph_edges),
    tool_calls: input.tool_calls.map((tc) => ({
      name: tc.name,
      input: redactDeep(tc.input),
      ok: tc.ok,
      ms: tc.ms,
    })),
    draft_ids: [...input.draft_ids],
    approval_decisions: (input.approval_decisions ?? []).map((d) => ({
      ...d,
      actor: redact(d.actor),
      role: d.role ? redact(d.role) : null,
    })),
    behaviour: input.behaviour,
    confidence: input.confidence,
    citations: redactDeep(input.citations),
    tokens: {
      input_tokens: input.usage.input_tokens,
      output_tokens: input.usage.output_tokens,
      total_tokens: input.usage.input_tokens + input.usage.output_tokens,
    },
    cost_usd: computedCost,
    latency_ms: input.latency_ms,
    created_at: new Date().toISOString(),
  };

  tracesById.set(trace_id, payload);
  for (const draftId of payload.draft_ids) {
    traceIdByDraftId.set(draftId, trace_id);
  }

  const client = input.client ?? activeClient();
  await client.trace(payload);
  return payload;
}

export interface RecordApprovalDecisionInput {
  type: "confirmation" | "cancellation" | "approver_step";
  draft_id?: string | null;
  request_id?: string | null;
  role?: string | null;
  actor: string;
  decision: "confirmed" | "cancelled" | "approve" | "reject";
  sla_breached?: boolean;
  at?: string;
  trace_id?: string;
  client?: LangfuseClientLike;
}

/**
 * Records an approval/confirmation/cancellation/step decision and attaches it to the
 * originating turn trace when known (FR-016, FR-017, Constitution IV).
 */
export async function recordApprovalDecision(
  input: RecordApprovalDecisionInput,
): Promise<ApprovalDecisionTrace> {
  const draftId = input.draft_id ?? null;
  const requestId = input.request_id ?? null;

  const resolvedTraceId =
    input.trace_id ??
    (draftId ? traceIdByDraftId.get(draftId) : undefined) ??
    (requestId ? traceIdByRequestId.get(requestId) : undefined) ??
    randomUUID();

  if (draftId) traceIdByDraftId.set(draftId, resolvedTraceId);
  if (requestId) traceIdByRequestId.set(requestId, resolvedTraceId);

  const decisionRecord: ApprovalDecisionTrace = {
    type: input.type,
    draft_id: draftId,
    request_id: requestId,
    role: input.role ? redact(input.role) : null,
    actor: redact(input.actor),
    decision: input.decision,
    sla_breached: Boolean(input.sla_breached),
    at: input.at ?? new Date().toISOString(),
    trace_id: resolvedTraceId,
  };

  const existingTrace = tracesById.get(resolvedTraceId);
  if (existingTrace) {
    existingTrace.approval_decisions.push(decisionRecord);
    if (draftId && !existingTrace.draft_ids.includes(draftId)) {
      existingTrace.draft_ids.push(draftId);
    }
  }

  const client = input.client ?? activeClient();
  if (client.event) {
    await client.event(decisionRecord);
  }
  if (existingTrace) {
    await client.trace(existingTrace);
  }

  return decisionRecord;
}
