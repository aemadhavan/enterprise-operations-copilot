import type Anthropic from "@anthropic-ai/sdk";
import type { McpToolClient } from "@/lib/mcp/client";
import type { ModelClient } from "@/lib/model";
import { addUsage, costUsd, ZERO_USAGE, type Usage } from "@/lib/model/pricing";

/** Loop limits (ADR-003, PRD §8.1 LLM10). */
export const MAX_ITERATIONS = 6;
export const MAX_TOKENS_PER_RESPONSE = 16000;
export const MAX_TOTAL_TOKENS = 250_000;

export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  ok: boolean;
  output: unknown;
  ms: number;
}

export type LoopStop = "end_turn" | "refusal" | "max_iterations" | "token_cap" | "max_tokens";

export interface LoopResult {
  stop: LoopStop;
  text: string; // final assistant text (JSON when outputSchema is set)
  tool_calls: ToolCallRecord[];
  iterations: number;
  usage: Usage;
  cost_usd: number;
  model: string;
}

export interface LoopInput {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: McpToolClient;
  model: Pick<ModelClient, "create" | "model">;
  /** JSON Schema for the final answer (`output_config.format`). */
  outputSchema?: Record<string, unknown>;
  onToolCall?: (call: ToolCallRecord) => void;
}

const toAnthropicTools = (tools: McpToolClient): Anthropic.Tool[] =>
  tools.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    strict: true,
  }));

const textOf = (m: Anthropic.Message) =>
  m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

/**
 * Hand-written tool-use loop (ADR-003, R-05). Only the tools on `tools` are offered; the
 * agent's MCP client lists `read` + `propose` tools only, so a `write` tool can never be
 * called from here (FR-010). Parallel tool calls run concurrently and their results go
 * back in one user message. On the last allowed iteration tools are switched off
 * (`tool_choice: none`) so the model must answer.
 */
export async function runAgentLoop(input: LoopInput): Promise<LoopResult> {
  const tools = toAnthropicTools(input.tools);
  const messages: Anthropic.MessageParam[] = [...input.messages];
  const calls: ToolCallRecord[] = [];
  let usage: Usage = ZERO_USAGE;
  let cost = 0;

  const done = (stop: LoopStop, text: string, iterations: number): LoopResult => ({
    stop,
    text,
    tool_calls: calls,
    iterations,
    usage,
    cost_usd: cost,
    model: input.model.model,
  });

  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const last = i === MAX_ITERATIONS;
    const res = await input.model.create({
      max_tokens: MAX_TOKENS_PER_RESPONSE,
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages,
      ...(tools.length ? { tools, tool_choice: last ? { type: "none" } : { type: "auto" } } : {}),
      ...(input.outputSchema
        ? { output_config: { format: { type: "json_schema", schema: input.outputSchema } } }
        : {}),
    });
    usage = addUsage(usage, res.usage);
    cost += costUsd(res.model ?? input.model.model, res.usage);

    if (res.stop_reason === "refusal") return done("refusal", "", i);
    if (res.stop_reason === "max_tokens") return done("max_tokens", textOf(res), i);

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0)
      return done("end_turn", textOf(res), i);

    // Keep the full assistant content (thinking and fallback blocks included).
    messages.push({ role: "assistant", content: res.content as Anthropic.ContentBlockParam[] });
    const results = await Promise.all(
      uses.map(async (u) => {
        const t0 = Date.now();
        const r = await input.tools.call(u.name, u.input);
        const rec: ToolCallRecord = {
          id: u.id,
          name: u.name,
          input: u.input,
          ok: r.ok,
          output: r.data,
          ms: Date.now() - t0,
        };
        calls.push(rec);
        input.onToolCall?.(rec);
        return {
          type: "tool_result" as const,
          tool_use_id: u.id,
          content: JSON.stringify(r.data),
          ...(r.ok ? {} : { is_error: true }),
        };
      }),
    );
    messages.push({ role: "user", content: results });

    if (usage.input_tokens + usage.output_tokens > MAX_TOTAL_TOKENS) {
      return done("token_cap", "", i);
    }
  }
  return done("max_iterations", "", MAX_ITERATIONS);
}
