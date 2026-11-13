import "../../scripts/_env";
import { afterAll, describe, expect, it } from "vitest";
import { closePool } from "@/lib/db/client";
import { createAgentClient } from "@/lib/mcp/client";
import { createMcpServer } from "@/lib/mcp/server";
import { readTools } from "@/lib/mcp/tools/read";

// Needs DATABASE_URL and a completed `pnpm ingest`.
const enabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)("read tools against Neon (FR-014, FR-009)", () => {
  afterAll(closePool);

  it("lookup_approvals for a contractor reading Atlas CRM gives the GS-009 chain and evidence edges", async () => {
    const c = await createAgentClient(createMcpServer(readTools()));
    const r = await c.call("lookup_approvals", {
      system_id: "SYS-CRM",
      requester_type: "Contractor",
      access_level: "read",
    });
    expect(r.ok).toBe(true);
    const data = r.data as {
      classification: string;
      chain: { role: string; approver_name: string | null }[];
      evidence_edges: { source: string; relation: string; target: string; source_doc: string }[];
    };
    expect(data.classification).toBe("Restricted");
    expect(data.chain.map((s) => s.role)).toEqual([
      "line_manager",
      "data_owner",
      "security_governance",
      "privacy_officer",
    ]);
    expect(data.chain[1].approver_name).toBe("Tom Gallagher");
    expect(data.evidence_edges.map((e) => `${e.source}|${e.relation}|${e.target}`)).toContain(
      "SYS-CRM|data_owner|PER-TGALLAGHER",
    );
    await c.close();
  });

  it("get_section resolves a clause number to its chunk", async () => {
    const c = await createAgentClient(createMcpServer(readTools()));
    const r = await c.call("get_section", { doc_id: "POL-014", section: "3.4" });
    expect(r.data).toMatchObject({ doc_id: "POL-014", section: expect.stringContaining("3.4") });
    expect((r.data as { text: string }).text).toMatch(/90/);
    await c.close();
  });
});
