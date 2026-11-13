import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { jsonSchemaFor } from "@/lib/agent/schemas";
import type { ConfirmationEvent, ToolCaller, ToolContext, ToolDef } from "./registry";

const fail = (code: string, message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }],
});

function contextFrom(meta: Record<string, unknown> | undefined): ToolContext {
  const caller: ToolCaller = meta?.caller === "confirm" ? "confirm" : "agent";
  const c = meta?.confirmation as Partial<ConfirmationEvent> | undefined;
  const confirmation =
    c &&
    typeof c.draft_id === "string" &&
    typeof c.confirmed_by === "string" &&
    typeof c.at === "string"
      ? (c as ConfirmationEvent)
      : undefined;
  return { caller, confirmation };
}

/**
 * In-process MCP server (ADR-004, FR-014). Each tool advertises `risk` and `allowed_roles`
 * in `_meta`; inputs are re-validated with Zod before execution (LLM05); `write` tools run
 * only for the confirm caller with a matching ConfirmationEvent (FR-010, Constitution II).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMcpServer(tools: ToolDef<any, unknown>[]): Server {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const server = new Server(
    { name: "kestrel-governance", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: jsonSchemaFor(t.input) as { type: "object" },
      _meta: { risk: t.risk, allowed_roles: t.allowed_roles },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = byName.get(req.params.name);
    if (!tool) return fail("unknown_tool", `No tool named ${req.params.name}`);
    const ctx = contextFrom(req.params._meta as Record<string, unknown> | undefined);

    if (!tool.allowed_roles.includes(ctx.caller)) {
      return fail("forbidden", `${tool.name} is not callable by ${ctx.caller}`);
    }
    if (tool.risk === "write") {
      const args = req.params.arguments as { draft_id?: unknown } | undefined;
      if (
        ctx.caller !== "confirm" ||
        !ctx.confirmation ||
        ctx.confirmation.draft_id !== args?.draft_id
      ) {
        return fail("confirmation_required", `${tool.name} needs an action confirmation (FR-010)`);
      }
    }
    const parsed = tool.input.safeParse(req.params.arguments ?? {});
    if (!parsed.success) return fail("invalid_input", parsed.error.message);
    try {
      const out = await tool.handler(parsed.data, ctx);
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    } catch (e) {
      return fail("tool_failed", e instanceof Error ? e.message : String(e));
    }
  });
  return server;
}
