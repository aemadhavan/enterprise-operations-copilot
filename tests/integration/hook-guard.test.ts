import "../../scripts/_env";
import { afterAll, describe, expect, it } from "vitest";
import { POST as confirmRoute } from "@/app/api/drafts/[id]/confirm/route";
import { GET as getRequestRoute } from "@/app/api/requests/[id]/route";
import { POST as simulatedApproverRoute } from "@/app/api/simulated-approver/route";
import { closePool, sql } from "@/lib/db/client";
import { createDraft } from "@/lib/drafts/drafts";
import { createAgentClient } from "@/lib/mcp/client";
import { createMcpServer } from "@/lib/mcp/server";
import { proposeTools } from "@/lib/mcp/tools/propose";
import { readTools } from "@/lib/mcp/tools/read";
import { writeTools } from "@/lib/mcp/tools/write";

const enabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("hook guard — /api/simulated-approver & MCP tool isolation (T040, FR-024a, SC-006)", () => {
  afterAll(closePool);

  it("rejects calls without x-approver-panel: 1 with 403", async () => {
    const res = await simulatedApproverRoute(
      new Request("http://localhost:3000/api/simulated-approver", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          host: "localhost:3000",
        },
        body: JSON.stringify({ request_id: "AR-0001", role: "sponsor", decision: "approve" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects cross-origin calls with 403 even when x-approver-panel: 1 is present", async () => {
    const res = await simulatedApproverRoute(
      new Request("http://localhost:3000/api/simulated-approver", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-approver-panel": "1",
          origin: "https://attacker.example",
          host: "localhost:3000",
        },
        body: JSON.stringify({ request_id: "AR-0001", role: "sponsor", decision: "approve" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects calls carrying the agent context marker with 403", async () => {
    for (const markerHeader of [
      { "x-agent-context": "1" },
      { "x-mcp-caller": "agent" },
    ] as Record<string, string>[]) {
      const res = await simulatedApproverRoute(
        new Request("http://localhost:3000/api/simulated-approver", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-approver-panel": "1",
            origin: "http://localhost:3000",
            host: "localhost:3000",
            ...markerHeader,
          },
          body: JSON.stringify({ request_id: "AR-0001", role: "sponsor", decision: "approve" }),
        }),
      );
      expect(res.status).toBe(403);
    }
  });

  it("exposes no MCP tool that can resume an approval hook or record an organisational approval", async () => {
    const allTools = [...readTools(), ...proposeTools(), ...writeTools()];
    for (const t of allTools) {
      expect(t.name).not.toMatch(/approve|resume|hook|simulated_approver/i);
    }
    const server = createMcpServer(allTools);
    const agentClient = await createAgentClient(server);
    try {
      for (const tool of agentClient.tools) {
        expect(tool.name).not.toMatch(/approve|resume|hook|simulated_approver/i);
      }
      const attempt = await agentClient.call("simulated_approver", {
        request_id: "AR-0001",
        role: "sponsor",
        decision: "approve",
      });
      expect(attempt.ok).toBe(false);
    } finally {
      await agentClient.close();
    }
  });

  it("accepts a valid UI panel call (x-approver-panel: 1 + same-origin) and records step_approved in timeline and audit_log", async () => {
    const drafted = await createDraft({
      requester_name: "Alex Chen",
      requester_type: "Contractor",
      sponsor: "Tom Gallagher",
      system_id: "SYS-CRM",
      access_level: "read",
      duration_days: 60,
      justification: "Customer-churn analysis",
    });
    expect(drafted.status).toBe("drafted");
    if (drafted.status !== "drafted") return;

    const cRes = await confirmRoute(
      new Request(`http://localhost:3000/api/drafts/${drafted.draft.draft_id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed_by: "Tom Gallagher" }),
      }),
      { params: Promise.resolve({ id: drafted.draft.draft_id }) },
    );
    expect(cRes.status).toBe(200);
    const { request_id } = (await cRes.json()) as { request_id: string };

    const panelRes = await simulatedApproverRoute(
      new Request("http://localhost:3000/api/simulated-approver", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-approver-panel": "1",
          origin: "http://localhost:3000",
          host: "localhost:3000",
        },
        body: JSON.stringify({ request_id, role: "sponsor", decision: "approve" }),
      }),
    );
    expect(panelRes.status).toBe(200);

    const statusRes = await getRequestRoute(
      new Request(`http://localhost:3000/api/requests/${request_id}`),
      { params: Promise.resolve({ id: request_id }) },
    );
    expect(statusRes.status).toBe(200);
    const timeline = (await statusRes.json()) as {
      request_id: string;
      steps: { seq: number; role: string; status: string }[];
    };
    const sponsorStep = timeline.steps.find((s) => s.role === "sponsor");
    expect(sponsorStep?.status).toBe("approved");

    const audits = (await sql`
      SELECT event FROM audit_log WHERE request_id = ${request_id} ORDER BY id
    `) as { event: string }[];
    expect(audits.map((a) => a.event)).toContain("step_approved");
  });
});
