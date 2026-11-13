import { describe, expect, it, vi } from "vitest";
import { answerTextRoute, orderEvidence } from "@/lib/agent/text-route";
import type { FinalAnswer } from "@/lib/agent/schemas";
import type { SearchResult } from "@/lib/retrieval/hybrid";

const chunk = (doc_id: string, section: string, is_authoritative = true): SearchResult => ({
  chunk_id: doc_id + section,
  doc_id,
  section,
  text: "text",
  score: 1,
  fts_rank: 1,
  vector_rank: 1,
  title: doc_id,
  doc_type: is_authoritative ? "policy" : "meeting_notes",
  version: "1",
  owner: null,
  effective_date: "2026-08-01",
  is_authoritative,
});

function fakeModel(answer: FinalAnswer | null, stop_reason = "end_turn") {
  const create = vi.fn(async () => ({
    stop_reason,
    content: answer ? [{ type: "text", text: JSON.stringify(answer) }] : [],
    usage: { input_tokens: 100, output_tokens: 50 },
  }));
  return { model: { model: "fake", create: create as never }, create };
}

const answer = (over: Partial<FinalAnswer>): FinalAnswer => ({
  behaviour: "answer",
  claims: [],
  assumptions: [],
  gaps: [],
  clarifying_question: null,
  legitimate_path: null,
  ...over,
});

describe("text route (FR-004, FR-007, FR-008)", () => {
  it("answers with filtered citations, confidence and markdown", async () => {
    const { model, create } = fakeModel(
      answer({
        claims: [
          {
            text: "Maximum 90 days, renewable once.",
            key: true,
            citations: [
              { doc_id: "POL-014", section: "§3.4" },
              { doc_id: "POL-999", section: "1" },
            ],
            source_status: "effective_policy",
          },
        ],
      }),
    );
    const r = await answerTextRoute("max duration?", {
      search: async () => [chunk("POL-014", "3. Requirements > 3.4")],
      model,
    });
    expect(r.answer.claims[0].citations).toEqual([
      { doc_id: "POL-014", section: "3. Requirements > 3.4" },
    ]);
    expect(r.dropped_citations).toBe(1);
    expect(r.confidence).toBe("high");
    expect(r.markdown).toContain("`POL-014 §3.4`");
    const body = (create.mock.calls[0] as unknown[])[0] as {
      output_config: { format: { type: string } };
      messages: { content: string }[];
    };
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.messages[0].content).toContain('status="effective_policy"');
  });

  it("returns state_gap without calling the model when nothing is retrieved", async () => {
    const { model, create } = fakeModel(null);
    const r = await answerTextRoute("gen AI policy?", { search: async () => [], model });
    expect(r.answer.behaviour).toBe("state_gap");
    expect(r.confidence).toBe("low");
    expect(create).not.toHaveBeenCalled();
  });

  it("turns an answer whose citations were all dropped into state_gap (Grounded or Silent)", async () => {
    const { model } = fakeModel(
      answer({
        claims: [
          {
            text: "Invented.",
            key: true,
            citations: [{ doc_id: "POL-777", section: "1" }],
            source_status: "effective_policy",
          },
        ],
      }),
    );
    const r = await answerTextRoute("q", {
      search: async () => [chunk("POL-014", "1. Scope")],
      model,
    });
    expect(r.answer.behaviour).toBe("state_gap");
  });

  it("handles a model refusal as a stated gap", async () => {
    const { model } = fakeModel(null, "refusal");
    const r = await answerTextRoute("q", {
      search: async () => [chunk("POL-014", "1. Scope")],
      model,
    });
    expect(r.answer.behaviour).toBe("state_gap");
  });

  it("orders effective-dated documents before meeting notes", () => {
    const out = orderEvidence([chunk("MTG-2026-10-14", "2", false), chunk("REF-005", "1")]);
    expect(out.map((c) => c.doc_id)).toEqual(["REF-005", "MTG-2026-10-14"]);
  });
});
