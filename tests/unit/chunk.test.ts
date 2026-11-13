import { describe, expect, it } from "vitest";
import { chunkDocument, parseDocument } from "@/lib/retrieval/chunk";

const RAW = `---
doc_id: POL-014
title: Customer Data Access Policy
doc_type: policy
version: "2.1"
effective_date: 2026-08-01
owner: Security Governance
source_system: Compass Wiki
---

> SYNTHETIC DOCUMENT.

# Customer Data Access Policy

## 1. Scope
Applies to all customer data.

## 3. Requirements
- **3.1** Requests go through PRC-012.
- **3.4** Contractor access is time-bound to a **maximum of 90 days**.
  It may be renewed once.

## 4. Exceptions
Security Governance may approve up to 30 days.
`;

describe("parseDocument", () => {
  it("reads front matter, normalises the date and hashes content", () => {
    const d = parseDocument(RAW);
    expect(d).toMatchObject({
      doc_id: "POL-014",
      doc_type: "policy",
      version: "2.1",
      effective_date: "2026-08-01",
      owner: "Security Governance",
      source_system: "Compass Wiki",
    });
    expect(d.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a document without doc_id", () => {
    expect(() => parseDocument("---\ntitle: x\n---\nbody")).toThrow(/doc_id/);
  });
});

describe("chunkDocument (R-07)", () => {
  const chunks = chunkDocument(parseDocument(RAW));
  const sections = chunks.map((c) => c.section);

  it("chunks by ## heading and splits numbered clauses into their own sections", () => {
    expect(sections).toEqual([
      "1. Scope",
      "3. Requirements > 3.1",
      "3. Requirements > 3.4",
      "4. Exceptions",
    ]);
  });

  it("keeps a clause's continuation lines and strips the bold marker", () => {
    const c = chunks.find((x) => x.section === "3. Requirements > 3.4")!;
    expect(c.text).toContain("maximum of 90 days");
    expect(c.text).toContain("renewed once");
    expect(c.text.startsWith("3.4 ")).toBe(true);
  });

  it("drops the preamble (synthetic banner and title) and empty sections", () => {
    expect(chunks.every((c) => !c.text.includes("SYNTHETIC"))).toBe(true);
  });

  it("keeps text under the # title as a section and splits each table row into its own chunk", () => {
    const raw = `---
doc_id: REF-004
title: Control Catalogue
doc_type: reference
---

> SYNTHETIC DOCUMENT.

# Control Catalogue

Controls referenced by policy.

| ID | Control |
|---|---|
| CTL-01 | MFA |
| **CTL-08** | Bulk export approval |
`;
    const header = "| ID | Control |\n|---|---|";
    expect(chunkDocument(parseDocument(raw))).toEqual([
      { doc_id: "REF-004", section: "Control Catalogue", text: "Controls referenced by policy." },
      {
        doc_id: "REF-004",
        section: "Control Catalogue > CTL-01",
        text: `${header}\n| CTL-01 | MFA |`,
      },
      {
        doc_id: "REF-004",
        section: "Control Catalogue > CTL-08",
        text: `${header}\n| **CTL-08** | Bulk export approval |`,
      },
    ]);
  });

  it("drops an empty section chunk when the section is only a table, and dedupes row keys", () => {
    const raw =
      "---\ndoc_id: X-1\ntitle: X\n---\n## Matrix\n| Role | Step |\n|---|---|\n| Sponsor | 1 |\n| Sponsor | 2 |\n";
    expect(chunkDocument(parseDocument(raw)).map((c) => c.section)).toEqual([
      "Matrix > Sponsor",
      "Matrix > Sponsor (2)",
    ]);
  });

  it("is deterministic", () => {
    expect(chunkDocument(parseDocument(RAW))).toEqual(chunks);
  });
});
