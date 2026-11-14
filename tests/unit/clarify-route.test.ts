import { describe, expect, it, vi } from "vitest";
import {
  answerClarifyRoute,
  classifyClarifyKind,
  normalizeSingleQuestion,
} from "@/lib/agent/clarify-route";
import type { FinalAnswer } from "@/lib/agent/schemas";

function fakeModel(answer: FinalAnswer | null, stop_reason = "end_turn") {
  const create = vi.fn(async () => ({
    stop_reason,
    content: answer ? [{ type: "text", text: JSON.stringify(answer) }] : [],
    usage: { input_tokens: 90, output_tokens: 45 },
  }));
  return { model: { model: "fake-sonnet", create: create as never }, create };
}

describe("clarify route (T052, FR-013, US5)", () => {
  it("classifies warehouse access (GS-029), underspecified action, and approval lookup (GS-030)", () => {
    expect(classifyClarifyKind("I need access to the warehouse.")).toBe("warehouse_access");
    expect(classifyClarifyKind("I need access to a database.")).toBe("action_request");
    expect(classifyClarifyKind("What approvals do I need?")).toBe("approval_lookup");
  });

  it("handles GS-029 ('I need access to the warehouse.') with one question confirming Lumen Data Warehouse + level/duration/requester/justification", async () => {
    const r = await answerClarifyRoute("I need access to the warehouse.");
    expect(r.answer.behaviour).toBe("clarify");
    expect(r.answer.claims).toEqual([]);
    const q = r.answer.clarifying_question ?? "";
    expect(q).toMatch(/Lumen Data Warehouse/i);
    expect(q).toMatch(/access level/i);
    expect(q).toMatch(/duration/i);
    expect(q).toMatch(/requester type|employee or contractor/i);
    expect(q).toMatch(/justification/i);
    expect(q.match(/\?/g)).toHaveLength(1);
    expect(r.markdown).toContain("Lumen Data Warehouse");
  });

  it("handles GS-030 ('What approvals do I need?') with one question asking system/data, requester type, and access level", async () => {
    const r = await answerClarifyRoute("What approvals do I need?");
    expect(r.answer.behaviour).toBe("clarify");
    expect(r.answer.claims).toEqual([]);
    const q = r.answer.clarifying_question ?? "";
    expect(q).toMatch(/target system or data/i);
    expect(q).toMatch(/employee or a? ?contractor/i);
    expect(q).toMatch(/access level/i);
    expect(q.match(/\?/g)).toHaveLength(1);
  });

  it("normalizes multi-question model outputs into a single question and strips unsupported claims", async () => {
    const { model, create } = fakeModel({
      behaviour: "clarify",
      claims: [
        {
          text: "Unsupported guess",
          key: true,
          citations: [{ doc_id: "REF-005", section: "1" }],
          source_status: "effective_policy",
        },
      ],
      assumptions: [],
      gaps: [],
      clarifying_question:
        "Which target system or data classification are you asking about? Are you an employee or contractor, and what access level (read, write, or admin) do you need?",
      legitimate_path: null,
    });

    const r = await answerClarifyRoute("What approvals do I need?", { model });
    expect(create).toHaveBeenCalledOnce();
    const callArg = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(callArg.tools).toBeUndefined();
    expect(r.answer.behaviour).toBe("clarify");
    expect(r.answer.claims).toEqual([]);
    expect(r.dropped_citations).toBe(1);
    expect((r.answer.clarifying_question ?? "").match(/\?/g)).toHaveLength(1);
  });

  it("falls back to deterministic single question when model output omits required dimensions", () => {
    const q = normalizeSingleQuestion("Which warehouse do you mean?", "warehouse_access");
    expect(q).toMatch(/Lumen Data Warehouse/i);
    expect(q).toMatch(/justification/i);
    expect(q.match(/\?/g)).toHaveLength(1);
  });
});
