import { describe, expect, it } from "vitest";
import { checkPolicy, SCENARIO_TODAY } from "@/lib/policy/checks";

describe("policy checks (T042, FR-011, FR-026)", () => {
  it("pins scenario today to 2026-11-13", () => {
    expect(SCENARIO_TODAY).toBe("2026-11-13");
  });

  it("allows contractor read access to Atlas CRM for <= 90 days (GS-022)", () => {
    const res = checkPolicy({
      system_id: "SYS-CRM",
      requester_type: "Contractor",
      access_level: "read",
      duration_days: 60,
    });
    expect(res.ok).toBe(true);
    expect(res.breaches).toHaveLength(0);
  });

  it("blocks contractor access to Customer PII over 90 days and cites POL-014 §3.4 + 30-day exception §4 (GS-023)", () => {
    const res = checkPolicy({
      system_id: "SYS-CRM",
      requester_type: "Contractor",
      access_level: "read",
      duration_days: 120,
    });
    expect(res.ok).toBe(false);
    expect(res.breaches).toHaveLength(1);
    expect(res.breaches[0]).toMatchObject({
      rule: "contractor_duration_max",
      limit: 90,
      value: 120,
      citation: "POL-014 §3.4",
    });
    expect(res.breaches[0].alternative).toMatch(/90 days/);
    expect(res.breaches[0].alternative).toMatch(/30 days.*POL-014 §4/);
  });

  it("blocks contractor admin access on a Restricted production system (GS-015, POL-022 §4)", () => {
    const res = checkPolicy({
      system_id: "SYS-HR",
      requester_type: "Contractor",
      access_level: "admin",
      duration_days: 30,
    });
    expect(res.ok).toBe(false);
    expect(res.breaches.map((b) => b.rule)).toContain("contractor_privileged_restricted");
    const breach = res.breaches.find((b) => b.rule === "contractor_privileged_restricted")!;
    expect(breach.citation).toBe("POL-022 §4");
    expect(breach.alternative).toMatch(/Head of Security Governance/);
  });

  it("blocks access when vendor assessment is already expired on 2026-11-13 (Quillon Data Services, GS-021)", () => {
    const res = checkPolicy({
      system_id: "SYS-CRM",
      requester_type: "Contractor",
      access_level: "read",
      duration_days: 30,
      vendor: "Quillon Data Services",
    });
    expect(res.ok).toBe(false);
    expect(res.breaches).toHaveLength(1);
    expect(res.breaches[0]).toMatchObject({
      rule: "vendor_assessment_expired",
      limit: "2026-11-13",
      value: "2026-09-30",
      citation: "VND-002 §3",
    });
  });

  it("warns (without blocking) when vendor assessment is valid today but expires before end_date (Northgate Consulting, GS-024)", () => {
    const res = checkPolicy({
      requester_type: "Contractor",
      vendor: "Northgate Consulting",
      start_date: "2026-12-01",
      end_date: "2027-02-28",
      restricted_access_expected: true,
    });
    expect(res.ok).toBe(true);
    expect(res.breaches).toHaveLength(0);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatchObject({
      code: "vendor_assessment_expires_before_end",
      valid_until: "2026-12-31",
      citation: "VND-002 Appendix A",
    });
  });

  it("passes with no vendor warning when vendor assessment outlasts the engagement (Brightline Analytics)", () => {
    const res = checkPolicy({
      system_id: "SYS-DWH",
      requester_type: "Contractor",
      access_level: "read",
      duration_days: 60,
      vendor: "Brightline Analytics",
    });
    expect(res.ok).toBe(true);
    expect(res.warnings).toHaveLength(0);
  });
});
