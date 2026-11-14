import "../../scripts/_env";
import { afterAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgentLoop } from "@/lib/agent/loop";
import { closePool, sql } from "@/lib/db/client";
import { createAgentClient } from "@/lib/mcp/client";
import { createMcpServer } from "@/lib/mcp/server";
import { proposeTools } from "@/lib/mcp/tools/propose";
import { readTools } from "@/lib/mcp/tools/read";
import { writeTools } from "@/lib/mcp/tools/write";

const enabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("confirmation gate — no execution without confirmation (T038, FR-010, SC-006)", () => {
  afterAll(closePool);

  it("agent MCP client tool list contains read + propose tools only and never a write tool", async () => {
    const server = createMcpServer([...readTools(), ...proposeTools(), ...writeTools()]);
    const agentClient = await createAgentClient(server);
    try {
      const names = agentClient.tools.map((t) => t.name);
      expect(names).toContain("propose_access_request");
      expect(names).toContain("check_policy");
      expect(names).not.toContain("create_access_request");
      expect(names).not.toContain("create_onboarding_ticket");
      expect(agentClient.tools.every((t) => t.risk === "read" || t.risk === "propose")).toBe(true);

      // Even a direct call attempt on the agent client is blocked before reaching the handler.
      const attempt = await agentClient.call("create_access_request", {
        draft_id: "00000000-0000-0000-0000-000000000000",
      });
      expect(attempt.ok).toBe(false);
    } finally {
      await agentClient.close();
    }
  });

  it("agent loop on GS-022 creates a proposed draft, never calls a write tool, and leaves access_requests empty", async () => {
    const server = createMcpServer([...readTools(), ...proposeTools(), ...writeTools()]);
    const agentClient = await createAgentClient(server);
    let step = 0;

    // Scripted model simulating GS-022: proposes the draft, then answers waiting for confirmation.
    const fakeModel = {
      model: "claude-sonnet-5-5",
      create: async (): Promise<Anthropic.Message> => {
        step += 1;
        if (step === 1) {
          return {
            id: "msg_gs022_1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5-5",
            stop_reason: "tool_use",
            stop_sequence: null,
            content: [
              {
                type: "tool_use",
                id: "toolu_gs022_propose",
                name: "propose_access_request",
                input: {
                  requester_name: "Alex Chen",
                  requester_type: "Contractor",
                  sponsor: "Tom Gallagher",
                  system_id: "SYS-CRM",
                  access_level: "read",
                  duration_days: 60,
                  justification: "Customer-churn analysis",
                },
              },
            ],
            usage: { input_tokens: 120, output_tokens: 60 } as Anthropic.Usage,
          };
        }
        return {
          id: "msg_gs022_2",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          stop_reason: "end_turn",
          stop_sequence: null,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                behaviour: "draft",
                claims: [],
                assumptions: [],
                gaps: [],
                clarifying_question: null,
                legitimate_path: null,
              }),
            },
          ],
          usage: { input_tokens: 200, output_tokens: 80 } as Anthropic.Usage,
        };
      },
    };

    try {
      const beforeCount = (await sql`SELECT count(*)::int AS n FROM access_requests`) as {
        n: number;
      }[];

      const loop = await runAgentLoop({
        system: "Draft the access request and wait for confirmation.",
        messages: [
          {
            role: "user",
            content:
              "Raise an access request for contractor Alex Chen, sponsored by Tom Gallagher, for read access to Atlas CRM for 60 days to support a customer-churn analysis.",
          },
        ],
        tools: agentClient,
        model: fakeModel,
      });

      expect(loop.stop).toBe("end_turn");
      expect(loop.tool_calls.map((c) => c.name)).toEqual(["propose_access_request"]);
      expect(loop.tool_calls.some((c) => c.name.startsWith("create_"))).toBe(false);

      const out = loop.tool_calls[0].output as {
        status: string;
        draft?: { draft_id: string; status: string };
      };
      expect(out.status).toBe("drafted");
      const draftId = out.draft?.draft_id;
      expect(typeof draftId).toBe("string");

      const afterCount = (await sql`SELECT count(*)::int AS n FROM access_requests`) as {
        n: number;
      }[];
      expect(afterCount[0].n).toBe(beforeCount[0].n);

      const reqRows = (await sql`
        SELECT request_id FROM access_requests WHERE draft_id = ${draftId!}::uuid
      `) as { request_id: string }[];
      expect(reqRows).toHaveLength(0);

      const auditRows = (await sql`
        SELECT event FROM audit_log WHERE draft_id = ${draftId!}::uuid ORDER BY id
      `) as { event: string }[];
      expect(auditRows.map((r) => r.event)).toEqual(["proposed"]);
    } finally {
      await agentClient.close();
    }
  });
});
