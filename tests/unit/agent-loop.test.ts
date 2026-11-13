import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { MAX_ITERATIONS, runAgentLoop } from "@/lib/agent/loop";
import type { McpToolClient } from "@/lib/mcp/client";

const usage = { input_tokens: 1000, output_tokens: 100 };
const msg = (stop_reason: string, content: Record<string, unknown>[]): Anthropic.Message =>
  ({ model: "claude-sonnet-5-5", stop_reason, content, usage }) as unknown as Anthropic.Message;
const toolUse = (id: string, name: string) => ({ type: "tool_use", id, name, input: { q: id } });

function fakeTools(): McpToolClient & { call: ReturnType<typeof vi.fn> } {
  return {
    tools: [
      {
        name: "search_documents",
        description: "s",
        input_schema: { type: "object" },
        risk: "read",
      },
      { name: "graph_query", description: "g", input_schema: { type: "object" }, risk: "read" },
    ],
    call: vi.fn(async (name: string) => ({ ok: name !== "graph_query", data: { name } })),
    close: async () => {},
  };
}

describe("agent loop (ADR-003, R-05, LLM10)", () => {
  it("runs parallel tool calls, returns all results in one user message, then answers", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        msg("tool_use", [toolUse("a", "search_documents"), toolUse("b", "graph_query")]),
      )
      .mockResolvedValueOnce(msg("end_turn", [{ type: "text", text: '{"ok":true}' }]));
    const tools = fakeTools();
    const r = await runAgentLoop({
      system: "sys",
      messages: [{ role: "user", content: "q" }],
      tools,
      model: { model: "claude-sonnet-5-5", create },
      outputSchema: { type: "object" },
    });
    expect(r).toMatchObject({ stop: "end_turn", text: '{"ok":true}', iterations: 2 });
    expect(r.tool_calls.map((c) => [c.name, c.ok])).toEqual([
      ["search_documents", true],
      ["graph_query", false],
    ]);
    const second = create.mock.calls[1][0];
    const lastMsg = second.messages.at(-1);
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toHaveLength(2);
    expect(lastMsg.content[1]).toMatchObject({ tool_use_id: "b", is_error: true });
    expect(second.tools.every((t: { strict: boolean }) => t.strict)).toBe(true);
    expect(second.output_config.format.type).toBe("json_schema");
    expect(r.usage.input_tokens).toBe(2000);
    expect(r.cost_usd).toBeCloseTo((2000 * 2 + 200 * 10) / 1e6, 8);
  });

  it(`stops after ${MAX_ITERATIONS} iterations and disables tools on the last one`, async () => {
    const create = vi.fn(async () => msg("tool_use", [toolUse("x", "search_documents")]));
    const r = await runAgentLoop({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools: fakeTools(),
      model: { model: "claude-sonnet-5-5", create },
    });
    expect(r.stop).toBe("max_iterations");
    expect(create).toHaveBeenCalledTimes(MAX_ITERATIONS);
    expect(
      (create.mock.calls.at(-1) as unknown as [{ tool_choice: unknown }])[0].tool_choice,
    ).toEqual({
      type: "none",
    });
  });

  it("returns refusal without running tools", async () => {
    const tools = fakeTools();
    const r = await runAgentLoop({
      system: "s",
      messages: [{ role: "user", content: "q" }],
      tools,
      model: { model: "claude-sonnet-5-5", create: async () => msg("refusal", []) },
    });
    expect(r.stop).toBe("refusal");
    expect(tools.call).not.toHaveBeenCalled();
  });
});
