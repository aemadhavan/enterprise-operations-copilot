import { describe, expect, it } from "vitest";
import { redact, redactDeep } from "@/lib/observability/redact";

describe("redact (FR-017)", () => {
  it("redacts email addresses", () => {
    expect(redact("mail alex.chen@kestrel.example now")).toBe("mail [REDACTED:email] now");
  });

  it.each([
    ["0412 345 678"],
    ["0412345678"],
    ["+61 412 345 678"],
    ["(03) 9123 4567"],
    ["+44 20 7946 0958"],
    ["+1-415-555-0132"],
  ])("redacts phone number %s", (phone) => {
    expect(redact(`call ${phone} today`)).toBe("call [REDACTED:phone] today");
  });

  it.each([
    ["4111 1111 1111 1111"],
    ["4111-1111-1111-1111"],
    ["4111111111111111"],
    ["378282246310005"],
  ])("redacts card-like number %s", (card) => {
    expect(redact(`card ${card}.`)).toBe("card [REDACTED:card].");
  });

  it("redacts ID-like tokens such as employee or customer numbers", () => {
    expect(redact("employee EMP-104233 and CUST99812")).toBe(
      "employee [REDACTED:id] and [REDACTED:id]",
    );
  });

  it("keeps allow-listed request, ticket, doc and golden-case IDs", () => {
    const text =
      "AR-0001 and TKT-0002 cite POL-014 §3.4, PRC-012, REF-005, VND-002, INC-2026-031, MTG-2026-10-14, GS-022";
    expect(redact(text)).toBe(text);
  });

  it("does not touch dates, durations, graph node IDs or short numbers", () => {
    const text = "Today 2026-11-13, 90 days, 30-day exception, SYS-CRM via APR-DO, 5 business days";
    expect(redact(text)).toBe(text);
  });

  it("redacts nested values without mutating the input", () => {
    const input = { actor: "tom@kestrel.example", details: { notes: ["ph 0412 345 678"], n: 3 } };
    const out = redactDeep(input);
    expect(out).toEqual({
      actor: "[REDACTED:email]",
      details: { notes: ["ph [REDACTED:phone]"], n: 3 },
    });
    expect(input.actor).toBe("tom@kestrel.example");
  });
});
