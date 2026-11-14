import { NextResponse } from "next/server";
import { z } from "zod";
import { runTurn, type TurnMode, type TurnResult } from "@/lib/agent/turn";
import { getConfig, type Config } from "@/lib/config";
import { redact } from "@/lib/observability/redact";

export const runtime = "nodejs";

export const ChatRequestSchema = z.object({
  conversation_id: z.string().min(1).default("default"),
  message: z.string().trim().min(1, "message is required").max(4000, "message exceeds 4000 chars"),
  stated_identity: z.string().trim().optional(),
  mode: z.enum(["graphrag", "baseline"]).optional(),
});

const WINDOW_MS = 60_000;
const ipHits = new Map<string, number[]>();
const dailySpend = new Map<string, number>();

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function resetChatLimits(): void {
  ipHits.clear();
  dailySpend.clear();
}

export function getDailySpend(ms: number = Date.now()): number {
  return dailySpend.get(dayKey(ms)) ?? 0;
}

export function recordSpend(usd: number, ms: number = Date.now()): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const k = dayKey(ms);
  dailySpend.set(k, (dailySpend.get(k) ?? 0) + usd);
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

function checkRateLimit(ip: string, limitPerMin: number, nowMs: number): boolean {
  const cutoff = nowMs - WINDOW_MS;
  const recent = (ipHits.get(ip) ?? []).filter((t) => t > cutoff);
  if (recent.length >= limitPerMin) {
    ipHits.set(ip, recent);
    return false;
  }
  recent.push(nowMs);
  ipHits.set(ip, recent);
  return true;
}

function jsonError(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export interface ChatRouteDeps {
  turn?: (message: string, opts: { mode?: TurnMode }) => Promise<TurnResult>;
  config?: Config;
  now?: () => number;
}

/**
 * POST /api/chat (T033, FR-006, PRD §8.2, contracts/http-api.md):
 * - validates body
 * - enforces per-IP rate limit (DEMO_RATE_LIMIT_PER_MIN)
 * - enforces daily spend cap (DEMO_DAILY_SPEND_CAP_USD)
 * - runs one turn through router + retrieval/graph/agent loop
 * - returns 503 { error: { code: "upstream_unavailable" } } when model or DB fails
 */
export async function handleChatPost(req: Request, deps: ChatRouteDeps = {}): Promise<Response> {
  const config = deps.config ?? getConfig();
  const now = deps.now ?? Date.now;
  const nowMs = now();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "Request body must be valid JSON.");
  }

  const parsed = ChatRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return jsonError(400, "invalid_request", msg);
  }

  const ip = clientIp(req);
  if (!checkRateLimit(ip, config.DEMO_RATE_LIMIT_PER_MIN, nowMs)) {
    return jsonError(
      429,
      "rate_limited",
      `Rate limit of ${config.DEMO_RATE_LIMIT_PER_MIN} requests per minute exceeded. Please try again shortly.`,
      { "Retry-After": "60" },
    );
  }

  const spent = getDailySpend(nowMs);
  if (spent >= config.DEMO_DAILY_SPEND_CAP_USD) {
    return jsonError(
      429,
      "daily_spend_cap_exceeded",
      `Daily demo spend cap of $${config.DEMO_DAILY_SPEND_CAP_USD.toFixed(2)} reached.`,
    );
  }

  const { message, mode } = parsed.data;
  const turn = deps.turn ?? ((q, o) => runTurn(q, o));

  try {
    const result = await turn(message, { mode });
    recordSpend(result.cost_usd, nowMs);
    return NextResponse.json({
      conversation_id: parsed.data.conversation_id,
      route: result.route,
      intent: result.intent,
      risk: result.risk,
      mode: result.mode,
      answer: result.answer,
      citations: result.citations,
      graph_path: result.graph_path,
      tool_calls: result.tool_calls,
      entities: result.entities,
      draft: result.draft,
      trace_id: result.trace_id,
      latency_ms: result.latency_ms,
      cost_usd: result.cost_usd,
      usage: result.usage,
    });
  } catch (err) {
    const detail = err instanceof Error ? redact(err.message) : "Upstream service error";
    return jsonError(
      503,
      "upstream_unavailable",
      `The model or knowledge store is temporarily unavailable (${detail}). No action was executed.`,
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  return handleChatPost(req);
}

