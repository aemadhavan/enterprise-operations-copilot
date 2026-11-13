import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, readGraphSeed, RELATIONS } from "@/lib/graph/load";

describe("graph loader (FR-002)", () => {
  it("parses quoted CSV fields with commas and doubled quotes", () => {
    expect(parseCsv('id,description\nA,"x, y ""z"""\nB,plain\n')).toEqual([
      { id: "A", description: 'x, y "z"' },
      { id: "B", description: "plain" },
    ]);
  });

  it("loads the real seed: 66 nodes, 122 edges, every relation valid, source_doc and condition kept", async () => {
    const { nodes, edges } = await readGraphSeed();
    expect(nodes).toHaveLength(66);
    expect(edges).toHaveLength(122);
    expect(edges.find((e) => e.relation === "implemented_by")).toMatchObject({
      source: "CTL-07",
      target: "PROC-REVIEW",
      source_doc: "PRC-019",
    });
    expect(edges.every((e) => (RELATIONS as readonly string[]).includes(e.relation))).toBe(true);
    expect(
      edges.find((e) => e.source === "ROLE-CONTRACTOR" && e.target === "APR-PRIV"),
    ).toMatchObject({ condition: "classification=Restricted", source_doc: "REF-005" });
    expect(nodes.find((n) => n.id === "SYS-CRM")).toMatchObject({
      label: "System",
      name: "Atlas CRM",
      classification: "Restricted",
    });
  });

  it("rejects an unknown relation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "seed-"));
    await writeFile(
      path.join(dir, "nodes.csv"),
      "id,label,name,classification,description,source_doc\nA,System,A,,,\nB,System,B,,,\n",
    );
    await writeFile(
      path.join(dir, "edges.csv"),
      "source,relation,target,condition,source_doc\nA,likes,B,,\n",
    );
    await expect(readGraphSeed(dir)).rejects.toThrow(/not one of the 16 relations/);
  });
});
