import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { isAgentRisk, type ConfirmationEvent, type ToolCaller } from "./registry";

export interface ListedTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  risk: string;
}

export interface ToolCallResult {
  ok: boolean;
  data: unknown;
}

export interface McpToolClient {
  tools: ListedTool[];
  call(name: string, args: unknown): Promise<ToolCallResult>;
  close(): Promise<void>;
}

/** Connect a client to the server over an in-memory transport (no child process). */
async function connect(server: Server) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "copilot", version: "0.1.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

async function build(
  server: Server,
  caller: ToolCaller,
  filter: (risk: unknown) => boolean,
  confirmation?: ConfirmationEvent,
): Promise<McpToolClient> {
  const client = await connect(server);
  const { tools } = await client.listTools();
  const listed: ListedTool[] = tools
    .filter((t) => filter(t._meta?.risk))
    .map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema as Record<string, unknown>,
      risk: String(t._meta?.risk),
    }));
  const allowed = new Set(listed.map((t) => t.name));

  return {
    tools: listed,
    async call(name, args) {
      // Defence in depth: refuse names this client did not list, before the server's own checks.
      if (!allowed.has(name)) {
        return { ok: false, data: { error: { code: "tool_not_allowed", message: name } } };
      }
      const res = await client.callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
        _meta: { caller, ...(confirmation ? { confirmation } : {}) },
      });
      const content = res.content as { type: string; text?: string }[];
      const text = content.find((c) => c.type === "text")?.text ?? "null";
      return { ok: !res.isError, data: JSON.parse(text) };
    },
    close: () => client.close(),
  };
}

/** The agent loop's client: `read` + `propose` tools only (FR-010 gate). */
export const createAgentClient = (server: Server) => build(server, "agent", isAgentRisk);

/** The confirm route's client: may call `write` tools with a ConfirmationEvent (T045/T046). */
export const createConfirmClient = (server: Server, confirmation: ConfirmationEvent) =>
  build(server, "confirm", (r) => r === "write", confirmation);
