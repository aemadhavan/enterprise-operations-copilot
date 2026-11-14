import { describe, expect, it } from "vitest";
import { checkSeparationOfDuties } from "@/lib/policy/sod";

describe("separation-of-duties warning (T043, FR-023)", () => {
  const crmChain = [
    { role: "line_manager" as const, approver_name: "Tom Gallagher" },
    { role: "data_owner" as const, approver_name: "Tom Gallagher" },
    { role: "security_governance" as const, approver_name: "Priya Nair" },
    { role: "privacy_officer" as const, approver_name: "Daniel Okafor" },
  ];

  it("emits a non-blocking warning when sponsor and data owner are the same person (GS-022)", () => {
    const w = checkSeparationOfDuties(crmChain, "Tom Gallagher");
    expect(w).not.toBeNull();
    expect(w).toMatchObject({
      code: "separation_of_duties",
      approver_name: "Tom Gallagher",
      roles: ["sponsor", "data_owner"],
      citation: "REF-005",
    });
    expect(w?.message).toMatch(/sponsor and data owner are the same person/i);
  });

  it("matches case-insensitively with surrounding whitespace", () => {
    const w = checkSeparationOfDuties(crmChain, "  tom gallagher ");
    expect(w?.code).toBe("separation_of_duties");
  });

  it("returns null when sponsor and data owner are distinct people", () => {
    const distinctChain = [
      { role: "line_manager" as const, approver_name: "Hannah Brooks" },
      { role: "data_owner" as const, approver_name: "Tom Gallagher" },
    ];
    expect(checkSeparationOfDuties(distinctChain, "Hannah Brooks")).toBeNull();
  });

  it("returns null when sponsor or data owner is unknown", () => {
    const unnamedChain = [
      { role: "line_manager" as const, approver_name: null },
      { role: "data_owner" as const, approver_name: "Tom Gallagher" },
    ];
    expect(checkSeparationOfDuties(unnamedChain, null)).toBeNull();
  });
});
