import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { handleAuditGet } from "@/app/api/audit/route";
import ApproverPanelPage, {
  APPROVER_ROLES,
  buildSimulatedApproverInit,
} from "@/app/approver/page";
import AuditLogPage from "@/app/audit/page";
import type { AuditRow } from "@/lib/audit/audit";

const sampleAuditRows: AuditRow[] = [
  {
    id: 1,
    at: "2026-11-14T01:00:00Z",
    actor: "Tom Gallagher (unverified)",
    event: "proposed",
    draft_id: "11111111-2222-3333-4444-555555555555",
    request_id: "AR-0001",
    ticket_id: null,
    details: { contact: "alex@example.com", system_id: "SYS-CRM" },
    policy_citations: ["REF-005", "POL-014"],
  },
];

describe("Simulated approver panel & audit log page + API (T058, FR-024a, FR-015)", () => {
  it("GET /api/audit returns redacted audit rows and validates query parameters", async () => {
    const list = vi.fn(async () => sampleAuditRows);
    const res = await handleAuditGet(
      new Request(
        "http://localhost:3000/api/audit?limit=25&request_id=AR-0001&draft_id=11111111-2222-3333-4444-555555555555",
      ),
      { list },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: AuditRow[]; count: number };
    expect(body.count).toBe(1);
    expect(body.rows[0].details.contact).toBe("[REDACTED:email]");
    expect(list).toHaveBeenCalledWith({
      limit: 25,
      request_id: "AR-0001",
      draft_id: "11111111-2222-3333-4444-555555555555",
    });

    const badLimit = await handleAuditGet(
      new Request("http://localhost:3000/api/audit?limit=9999"),
      { list },
    );
    expect(badLimit.status).toBe(400);

    const badUuid = await handleAuditGet(
      new Request("http://localhost:3000/api/audit?draft_id=not-a-uuid"),
      { list },
    );
    expect(badUuid.status).toBe(400);
  });

  it("GET /api/audit returns 503 upstream_unavailable when the database throws", async () => {
    const res = await handleAuditGet(new Request("http://localhost:3000/api/audit"), {
      list: async () => {
        throw new Error("DB connection failed for admin@example.com");
      },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("upstream_unavailable");
    expect(body.error.message).toContain("[REDACTED:email]");
  });

  it("builds simulated approver requests with x-approver-panel: 1 and renders one button per role", () => {
    const init = buildSimulatedApproverInit({
      request_id: "AR-0001",
      role: "sponsor",
      decision: "approve",
    });
    expect((init.headers as Record<string, string>)["x-approver-panel"]).toBe("1");

    const html = renderToStaticMarkup(React.createElement(ApproverPanelPage));
    expect(html).toContain("SIMULATED");
    expect(html).toContain("x-approver-panel: 1");
    for (const r of APPROVER_ROLES) {
      expect(html).toContain(`Approve as ${r.label}`);
    }
  });

  it("renders AuditLogPage with SIMULATED badge and filter controls", () => {
    const html = renderToStaticMarkup(React.createElement(AuditLogPage));
    expect(html).toContain("Append-Only Governance Audit Log");
    expect(html).toContain("SIMULATED");
    expect(html).toContain("REVOKE UPDATE, DELETE");
  });
});
