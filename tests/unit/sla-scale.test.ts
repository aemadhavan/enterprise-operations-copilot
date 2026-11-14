import { describe, expect, it, vi } from "vitest";
import type { WriteAuditInput } from "@/lib/audit/audit";
import { scaledSlaMs, scaledSlaSeconds } from "@/lib/workflow/engine";
import { createInMemoryApprovalEngine } from "@/lib/workflow/in-memory";

describe("SLA time scaling and in-memory approval engine (T047, FR-024, FR-024b)", () => {
  it("scales a 5-business-day SLA to 5 * N seconds (and 2-business-day to 2 * N seconds)", () => {
    expect(scaledSlaSeconds(5, 60)).toBe(300);
    expect(scaledSlaMs(5, 60)).toBe(300_000);
    expect(scaledSlaSeconds(5, 3)).toBe(15);
    expect(scaledSlaMs(5, 3)).toBe(15_000);
    expect(scaledSlaSeconds(2, 10)).toBe(20);
  });

  it("records sla_breached on the pending step and in audit when no approver acts within 5 * N seconds", async () => {
    vi.useFakeTimers();
    try {
      const audits: WriteAuditInput[] = [];
      const engine = createInMemoryApprovalEngine({
        scaleSecondsPerBusinessDay: 2, // 5 business days => 5 * 2 = 10 seconds (10_000 ms)
        persist: false,
        audit: async (e) => {
          audits.push(e);
        },
      });

      const started = await engine.start({
        type: "access_request.submitted",
        request_id: "AR-0099",
        draft_id: "00000000-0000-0000-0000-000000000099",
        request: {
          requester_name: "Alex Chen",
          requester_type: "Contractor",
          sponsor: "Tom Gallagher",
          system_id: "SYS-CRM",
          access_level: "read",
          duration_days: 60,
          justification: "Customer-churn analysis",
        },
        approval_chain: [
          { seq: 1, role: "sponsor", approver_name: "Tom Gallagher" },
          { seq: 2, role: "data_owner", approver_name: "Tom Gallagher" },
          { seq: 3, role: "security_governance", approver_name: "Priya Nair" },
          { seq: 4, role: "privacy_officer", approver_name: "Daniel Okafor" },
        ],
        sla_business_days: 5,
        emitted_at: "2026-11-13T09:00:00.000Z",
      });

      expect(started.sla_timeout_ms).toBe(10_000);
      expect(started.steps[0].status).toBe("pending");

      // Before 5 * N seconds: still pending, no sla_breached event
      await vi.advanceTimersByTimeAsync(9_900);
      const before = await engine.status("AR-0099");
      expect(before?.steps[0].status).toBe("pending");
      expect(audits).toHaveLength(0);

      // At 5 * N = 10 seconds: sla_breached fires
      await vi.advanceTimersByTimeAsync(200);
      const after = await engine.status("AR-0099");
      expect(after?.steps[0].status).toBe("sla_breached");
      expect(after?.events.map((e) => e.event)).toContain("sla_breached");
      expect(audits.map((a) => a.event)).toEqual(["sla_breached"]);
      expect(audits[0].details).toMatchObject({
        seq: 1,
        role: "sponsor",
        sla_business_days: 5,
        sla_timeout_ms: 10_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("advances steps on approve and marks request approved when all steps approve", async () => {
    const audits: WriteAuditInput[] = [];
    const engine = createInMemoryApprovalEngine({
      scaleSecondsPerBusinessDay: 60,
      persist: false,
      audit: async (e) => {
        audits.push(e);
      },
    });

    await engine.start({
      type: "access_request.submitted",
      request_id: "AR-0100",
      draft_id: "00000000-0000-0000-0000-000000000100",
      request: {
        requester_name: "Alex Chen",
        requester_type: "Contractor",
        sponsor: "Tom Gallagher",
        system_id: "SYS-WIKI",
        access_level: "read",
        duration_days: 30,
        justification: "Docs lookup",
      },
      approval_chain: [{ seq: 1, role: "sponsor", approver_name: "Tom Gallagher" }],
      sla_business_days: 2,
      emitted_at: "2026-11-13T09:00:00.000Z",
    });

    const updated = await engine.resume({
      request_id: "AR-0100",
      role: "sponsor",
      decision: "approve",
    });
    expect(updated.status).toBe("approved");
    expect(updated.steps[0].status).toBe("approved");
    expect(audits.map((a) => a.event)).toEqual(["step_approved", "request_completed"]);
  });
});
