import { describe, expect, it } from "vitest";
import { formatAuditActor, redactDetails } from "@/lib/audit/audit";

describe("audit writer helpers (T041, FR-015, FR-017)", () => {
  it("labels stated actors as unverified and redacts PII in actor strings", () => {
    expect(formatAuditActor("Tom Gallagher")).toBe("Tom Gallagher (unverified)");
    expect(formatAuditActor("Tom Gallagher (unverified)")).toBe("Tom Gallagher (unverified)");
    expect(formatAuditActor("")).toBe("anonymous (unverified)");
    expect(formatAuditActor("tom@kestrel.example")).toBe("[REDACTED:email] (unverified)");
  });

  it("deep-redacts strings inside details objects and arrays while keeping allow-listed IDs", () => {
    const out = redactDetails({
      contact: "Email alex@example.com or +61 412 345 678",
      nested: [{ emp: "EMP-99123", req: "AR-0001", doc: "POL-014" }],
      count: 60,
    });
    expect(out).toEqual({
      contact: "Email [REDACTED:email] or [REDACTED:phone]",
      nested: [{ emp: "[REDACTED:id]", req: "AR-0001", doc: "POL-014" }],
      count: 60,
    });
  });
});
