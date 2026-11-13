import { beforeAll, describe, expect, it } from "vitest";
import { readGraphSeed } from "@/lib/graph/load";
import { resolveApprovals, type Graph } from "@/lib/policy/approvals";

let graph: Graph;
beforeAll(async () => {
  graph = await readGraphSeed();
});

const roles = (r: ReturnType<typeof resolveApprovals>) => r.chain.map((s) => s.role);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("REF-005 approval resolver (FR-009)", () => {
  it("GS-009: contractor read on Atlas CRM → 4 approvals in PRC-012 §3 order, named approvers", () => {
    const r = resolveApprovals(graph, {
      system_id: "SYS-CRM",
      requester_type: "Contractor",
      access_level: "read",
      sponsor: "Tom Gallagher",
    });
    expect(r.classification).toBe("Restricted");
    expect(r.chain).toEqual([
      {
        seq: 1,
        role: "line_manager",
        approval_id: "APR-LM",
        approver_name: "Tom Gallagher",
        source_doc: "REF-005",
      },
      {
        seq: 2,
        role: "data_owner",
        approval_id: "APR-DO",
        approver_name: "Tom Gallagher",
        source_doc: "REF-003",
      },
      {
        seq: 3,
        role: "security_governance",
        approval_id: "APR-SEC",
        approver_name: "Priya Nair",
        source_doc: "REF-005",
      },
      {
        seq: 4,
        role: "privacy_officer",
        approval_id: "APR-PRIV",
        approver_name: "Daniel Okafor",
        source_doc: "REF-005",
      },
    ]);
    expect(ids(r.prerequisites)).toEqual(["CTL-02", "CTL-03", "CTL-04", "CTL-09"]);
    expect(ids(r.controls)).toEqual(["CTL-01", "CTL-02", "CTL-05", "CTL-06", "CTL-07", "CTL-08"]);
  });

  it("leaves the line manager unnamed when no sponsor is stated", () => {
    const r = resolveApprovals(graph, {
      system_id: "SYS-CRM",
      requester_type: "Contractor",
      access_level: "read",
    });
    expect(r.chain[0]).toMatchObject({ role: "line_manager", approver_name: null });
  });

  it("GS-011: contractor on Ledger Billing adds Finance Systems Lead sign-off and PCI training", () => {
    const r = resolveApprovals(graph, {
      system_id: "SYS-BILL",
      requester_type: "Contractor",
      access_level: "read",
    });
    expect(roles(r)).toEqual([
      "line_manager",
      "data_owner",
      "security_governance",
      "privacy_officer",
      "finance_systems_lead",
    ]);
    expect(r.chain.find((s) => s.role === "data_owner")?.approver_name).toBe("Sofia Reyes");
    expect(r.chain.find((s) => s.role === "finance_systems_lead")?.approver_name).toBe(
      "Sofia Reyes",
    );
    expect(ids(r.controls)).toContain("CTL-10");
  });

  it("GS-015: contractor admin on Pulse HRIS adds Head of Security Governance after Security Governance", () => {
    const r = resolveApprovals(graph, {
      system_id: "SYS-HR",
      requester_type: "Contractor",
      access_level: "admin",
    });
    expect(roles(r)).toEqual([
      "line_manager",
      "data_owner",
      "security_governance",
      "head_of_security_governance",
      "privacy_officer",
    ]);
    expect(r.chain.find((s) => s.role === "head_of_security_governance")).toMatchObject({
      approver_name: "Priya Nair",
      source_doc: "POL-022",
    });
    expect(r.chain.find((s) => s.role === "data_owner")?.approver_name).toBe("Hannah Brooks");
  });

  it("employee on a Confidential system needs line manager + data owner only", () => {
    const r = resolveApprovals(graph, {
      system_id: "SYS-HELP",
      requester_type: "Employee",
      access_level: "read",
    });
    expect(r.classification).toBe("Confidential");
    expect(roles(r)).toEqual(["line_manager", "data_owner"]);
    expect(r.prerequisites).toEqual([]);
  });

  it("contractor on an Internal system needs only the sponsor", () => {
    const r = resolveApprovals(graph, {
      system_id: "SYS-WIKI",
      requester_type: "Contractor",
      access_level: "read",
    });
    expect(roles(r)).toEqual(["line_manager"]);
    expect(ids(r.prerequisites)).toEqual(["CTL-03", "CTL-04"]);
  });

  it("admin on a non-Restricted system keeps the POL-041 privileged-access controls", () => {
    const r = resolveApprovals(graph, {
      system_id: "SYS-WIKI",
      requester_type: "Employee",
      access_level: "admin",
    });
    expect(r.classification).toBe("Internal");
    expect(ids(r.prerequisites)).toEqual(expect.arrayContaining(["CTL-01", "CTL-06"]));
    expect(r.prerequisites.find((p) => p.id === "CTL-06")?.source_doc).toBe("POL-041");
  });

  it("throws for an unknown system", () => {
    expect(() =>
      resolveApprovals(graph, {
        system_id: "SYS-NOPE",
        requester_type: "Employee",
        access_level: "read",
      }),
    ).toThrow(/SYS-NOPE/);
  });
});
