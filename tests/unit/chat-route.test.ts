import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDailySpend,
  handleChatPost,
  recordSpend,
  resetChatLimits,
} from "@/app/api/chat/route";
import type { TurnResult } from "@/lib/agent/turn";
import { parseConfig } from "@/lib/config";

const stubTurnResult = (overrides: Partial<TurnResult> = {}): TurnResult => ({
  route: "text",
  intent: "lookup",
  risk: "low",
  mode: "graphrag",
  answer: {
    markdown: "- Maximum 90 days `POL-014 §3.4`",
    claims: [
      {
        text: "Maximum 90 days",
        key: true,
        citations: [{ doc_id: "POL-014", section: "3. Requirements > 3.4" }],
        source_status: "effective_policy",
      },
    ],
    assumptions: [],
    gaps: [],
    confidence: "high",
    behaviour: "answer",
    legitimate_path: null,
    clarifying_question: null,
  },
  citations: [{ doc_id: "POL-014", section: "3. Requirements > 3.4" }],
  graph_path: { nodes: [], edges: [] },
  tool_calls: [],
  draft: null,
  entities: [],
  dropped_citations: 0,
  latency_ms: 420,
  cost_usd: 0.006,
  usage: { input_tokens: 1200, output_tokens: 120 },
  trace_id: null,
  ...overrides,
});

const makeReq = (body: unknown, ip = "203.0.113.10") =>
  new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/chat (T033, FR-006, PRD §8.2)", () => {
  beforeEach(() => {
    resetChatLimits();
  });

  it("returns 200 with contract fields and records cost toward daily spend", async () => {
    const config = parseConfig({ DEMO_RATE_LIMIT_PER_MIN: "10", DEMO_DAILY_SPEND_CAP_USD: "5" });
    const turn = vi.fn(async () => stubTurnResult({ cost_usd: 0.012 }));

    const res = await handleChatPost(
      makeReq({ conversation_id: "c1", message: "What is the max duration?" }),
      { turn, config },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.route).toBe("text");
    expect(json.answer.confidence).toBe("high");
    expect(json.citations).toEqual([{ doc_id: "POL-014", section: "3. Requirements > 3.4" }]);
    expect(json.cost_usd).toBe(0.012);
    expect(getDailySpend()).toBeCloseTo(0.012, 6);
    expect(turn).toHaveBeenCalledWith("What is the max duration?", { mode: undefined });
  });

  it("rejects invalid JSON or empty message with 400", async () => {
    const r1 = await handleChatPost(makeReq("{not-json"));
    expect(r1.status).toBe(400);
    expect((await r1.json()).error.code).toBe("invalid_json");

    const r2 = await handleChatPost(makeReq({ conversation_id: "c1", message: "   " }));
    expect(r2.status).toBe(400);
    expect((await r2.json()).error.code).toBe("invalid_request");
  });

  it("enforces per-IP rate limit (DEMO_RATE_LIMIT_PER_MIN) within 60s window", async () => {
    const config = parseConfig({ DEMO_RATE_LIMIT_PER_MIN: "2", DEMO_DAILY_SPEND_CAP_USD: "5" });
    const turn = vi.fn(async () => stubTurnResult());
    let nowMs = 1_700_000_000_000;

    const r1 = await handleChatPost(makeReq({ message: "q1" }), {
      turn,
      config,
      now: () => nowMs,
    });
    const r2 = await handleChatPost(makeReq({ message: "q2" }), {
      turn,
      config,
      now: () => nowMs,
    });
    const r3 = await handleChatPost(makeReq({ message: "q3" }), {
      turn,
      config,
      now: () => nowMs,
    });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect((await r3.json()).error.code).toBe("rate_limited");
    expect(turn).toHaveBeenCalledTimes(2);

    // After 61 seconds the window slides and requests succeed again
    nowMs += 61_000;
    const r4 = await handleChatPost(makeReq({ message: "q4" }), {
      turn,
      config,
      now: () => nowMs,
    });
    expect(r4.status).toBe(200);
  });

  it("enforces daily spend cap (DEMO_DAILY_SPEND_CAP_USD)", async () => {
    const config = parseConfig({ DEMO_RATE_LIMIT_PER_MIN: "10", DEMO_DAILY_SPEND_CAP_USD: "0.02" });
    const turn = vi.fn(async () => stubTurnResult({ cost_usd: 0.015 }));
    const nowMs = Date.parse("2026-11-14T01:00:00Z");

    recordSpend(0.01, nowMs);
    const r1 = await handleChatPost(makeReq({ message: "q1" }), {
      turn,
      config,
      now: () => nowMs,
    });
    expect(r1.status).toBe(200);

    // Spend is now 0.025 >= 0.02 cap
    const r2 = await handleChatPost(makeReq({ message: "q2" }), {
      turn,
      config,
      now: () => nowMs,
    });
    expect(r2.status).toBe(429);
    expect((await r2.json()).error.code).toBe("daily_spend_cap_exceeded");
    expect(turn).toHaveBeenCalledTimes(1);
  });

  it("returns 503 upstream_unavailable when the model or database throws", async () => {
    const config = parseConfig({});
    const turn = vi.fn(async () => {
      throw new Error("Connection terminated unexpectedly by alex@example.com");
    });

    const res = await handleChatPost(makeReq({ message: "q1" }), { turn, config });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("upstream_unavailable");
    expect(body.error.message).toContain("[REDACTED:email]");
    expect(body.error.message).not.toContain("alex@example.com");
  });
});

