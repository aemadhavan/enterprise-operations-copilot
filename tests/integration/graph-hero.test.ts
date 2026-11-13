import "../../scripts/_env";
import { afterAll, describe, expect, it } from "vitest";
import { closePool } from "@/lib/db/client";
import { graphQuery } from "@/lib/graph/query";

// Needs DATABASE_URL and a completed `pnpm ingest` (graph seed loaded).
const enabled = Boolean(process.env.DATABASE_URL);
const key = (e: { source: string; relation: string; target: string }) =>
  `${e.source} -${e.relation}-> ${e.target}`;

describe.skipIf(!enabled)("graph_query hero traversal, GS-009 (FR-005b)", () => {
  afterAll(closePool);

  it("node mode from SYS-CRM reaches the data class, its controls and the data owner", async () => {
    const { nodes, edges } = await graphQuery({ mode: "node", start_id: "SYS-CRM", max_hops: 2 });
    const got = new Set(edges.map(key));
    for (const e of [
      "SYS-CRM -stores-> DC-CUST-PII",
      "DC-CUST-PII -requires-> CTL-01",
      "DC-CUST-PII -requires-> CTL-05",
      "DC-CUST-PII -requires-> CTL-06",
      "DC-CUST-PII -requires-> CTL-07",
      "DC-CUST-PII -requires-> CTL-08",
      "DC-CUST-PII -requires-> CTL-02",
      "SYS-CRM -data_owner-> PER-TGALLAGHER",
    ]) {
      expect(got, e).toContain(e);
    }
    expect(nodes.find((n) => n.id === "DC-CUST-PII")?.classification).toBe("Restricted");
    const ctl02 = edges.find((e) => key(e) === "DC-CUST-PII -requires-> CTL-02");
    expect(ctl02).toMatchObject({ condition: "requester=Contractor", source_doc: "POL-014" });
    expect(edges.every((e) => typeof e.source_doc === "string")).toBe(true);
  });

  it("node mode from ROLE-CONTRACTOR reaches the four approvals, prerequisites and named approvers", async () => {
    const { edges } = await graphQuery({ mode: "node", start_id: "ROLE-CONTRACTOR", max_hops: 2 });
    const got = new Set(edges.map(key));
    for (const e of [
      "ROLE-CONTRACTOR -requires-> APR-LM",
      "ROLE-CONTRACTOR -requires-> APR-DO",
      "ROLE-CONTRACTOR -requires-> APR-SEC",
      "ROLE-CONTRACTOR -requires-> APR-PRIV",
      "ROLE-CONTRACTOR -requires-> CTL-03",
      "ROLE-CONTRACTOR -requires-> CTL-04",
      "ROLE-CONTRACTOR -requires-> CTL-09",
      "ROLE-CONTRACTOR -requires-> CTL-02",
      "APR-SEC -approved_by-> PER-PNAIR",
      "APR-PRIV -approved_by-> PER-DOKAFOR",
    ]) {
      expect(got, e).toContain(e);
    }
    // APR-DO has no approved_by edge: the data owner is resolved via the system's data_owner edge.
    expect([...got].some((e) => e.startsWith("APR-DO -approved_by->"))).toBe(false);
  });

  it("label mode: Restricted systems and their data owners (GS-010)", async () => {
    const { nodes, edges } = await graphQuery({
      mode: "label",
      label: "System",
      classification: "Restricted",
    });
    const systems = nodes.filter((n) => n.label === "System").map((n) => n.id);
    expect(systems.sort()).toEqual(["SYS-BILL", "SYS-CRM", "SYS-DWH", "SYS-HR", "SYS-IAM"]);
    const owners = edges.filter((e) => e.relation === "data_owner");
    expect(owners).toHaveLength(5);
    expect(owners.every((e) => e.source_doc === "REF-003")).toBe(true);
  });

  it("label mode with a condition filter keeps only matching edges", async () => {
    const { edges } = await graphQuery({
      mode: "label",
      label: "Role",
      condition: "requester=Contractor",
    });
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.condition?.includes("requester=Contractor"))).toBe(true);
  });

  it("relation mode: every led_to edge with its incident source_doc (GS-013)", async () => {
    const { edges } = await graphQuery({ mode: "relation", relation: "led_to" });
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => e.relation === "led_to")).toBe(true);
    expect(new Set(edges.map((e) => e.source))).toEqual(new Set(["INC-2026-031", "INC-2026-044"]));
  });

  it("rejects an invalid input (Zod re-validation)", async () => {
    await expect(
      graphQuery({ mode: "node", start_id: "SYS-CRM", max_hops: 9 } as never),
    ).rejects.toThrow();
  });

  it("does not walk backwards into the Employee chain from the contractor seed", async () => {
    const { edges } = await graphQuery({ mode: "node", start_id: "ROLE-CONTRACTOR", max_hops: 2 });
    expect(edges.some((e) => e.source === "ROLE-EMP")).toBe(false);
  });
});
