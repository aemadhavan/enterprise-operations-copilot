import { describe, expect, it } from "vitest";
import { createAgentClient } from "@/lib/mcp/client";
import { createMcpServer } from "@/lib/mcp/server";
import { proposeTools } from "@/lib/mcp/tools/propose";

describe("propose MCP tools (T044, FR-009, FR-014)", () => {
  it("exposes check_policy (read) and propose_access_request (propose) to the agent client", async () => {
    const server = createMcpServer(
      proposeTools({
        check: () => ({ ok: true, breaches: [], warnings: [], citations: ["POL-014"] }),
        draft: async (input) => ({
          status: "needs_fields",
          missing: input.sponsor ? [] : ["sponsor"],
        }),
      }),
    );
    const client = await createAgentClient(server);
    try {
      expect(client.tools.map((t) => ({ name: t.name, risk: t.risk }))).toEqual([
        { name: "check_policy", risk: "read" },
        { name: "propose_access_request", risk: "propose" },
      ]);

      const checkRes = await client.call("check_policy", {
        system_id: "SYS-CRM",
        requester_type: "Contractor",
        access_level: "read",
        duration_days: 60,
      });
      expect(checkRes.ok).toBe(true);
      expect(checkRes.data).toMatchObject({ ok: true, breaches: [] });

      const draftRes = await client.call("propose_access_request", {
        requester_name: "Alex Chen",
        requester_type: "Contractor",
        system_id: "SYS-CRM",
        access_level: "read",
        duration_days: 60,
      });
      expect(draftRes.ok).toBe(true);
      expect(draftRes.data).toEqual({ status: "needs_fields", missing: ["sponsor"] });
    } finally {
      await client.close();
    }
  });
});
