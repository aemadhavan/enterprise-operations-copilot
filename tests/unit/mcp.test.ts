import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgentClient, createConfirmClient } from "@/lib/mcp/client";
import { defineTool, type ToolCaller } from "@/lib/mcp/registry";
import { createMcpServer } from "@/lib/mcp/server";

const calls: string[] = [];
const tool = (name: string, risk: string, roles: ToolCaller[] = ["agent"]) =>
  defineTool({
    name,
    description: name,
    risk: risk as never,
    allowed_roles: roles,
    input: z.strictObject({ draft_id: z.string().optional(), n: z.number().optional() }),
    handler: async (input) => {
      calls.push(name);
      return { echoed: input };
    },
  });

const tools = () => [
  tool("search", "read"),
  tool("propose", "propose"),
  tool("write_it", "write", ["confirm"]),
  tool("mystery", "unknown"),
];

describe("in-process MCP server and agent client (FR-014, FR-010)", () => {
  it("agent client lists read + propose tools only; write and unknown risk are excluded", async () => {
    const c = await createAgentClient(createMcpServer(tools()));
    expect(c.tools.map((t) => [t.name, t.risk])).toEqual([
      ["search", "read"],
      ["propose", "propose"],
    ]);
    expect(c.tools[0].input_schema).toMatchObject({ type: "object" });
    await c.close();
  });

  it("agent client cannot call a write tool, even by name", async () => {
    calls.length = 0;
    const c = await createAgentClient(createMcpServer(tools()));
    expect((await c.call("write_it", { draft_id: "d1" })).ok).toBe(false);
    expect(calls).toEqual([]);
    await c.close();
  });

  it("server re-validates input with Zod", async () => {
    const c = await createAgentClient(createMcpServer(tools()));
    expect(await c.call("search", { n: "not a number" })).toMatchObject({
      ok: false,
      data: { error: { code: "invalid_input" } },
    });
    expect(await c.call("search", { n: 2 })).toEqual({ ok: true, data: { echoed: { n: 2 } } });
    await c.close();
  });

  it("write tool runs only with a matching ConfirmationEvent", async () => {
    calls.length = 0;
    const conf = { draft_id: "d1", confirmed_by: "Tom", at: "2026-11-14T00:00:00Z" };
    const c = await createConfirmClient(createMcpServer(tools()), conf);
    expect((await c.call("write_it", { draft_id: "other" })).data).toMatchObject({
      error: { code: "confirmation_required" },
    });
    expect((await c.call("write_it", { draft_id: "d1" })).ok).toBe(true);
    expect(calls).toEqual(["write_it"]);
    await c.close();
  });
});
