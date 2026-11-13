import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "@neondatabase/serverless";

/** The 16 relations in data/graph_seed/README.md (FR-002). */
export const RELATIONS = [
  "governs",
  "protects",
  "uses",
  "stores",
  "feeds",
  "owned_by",
  "data_owner",
  "member_of",
  "responsible_for",
  "requires",
  "approved_by",
  "assessed_under",
  "affects",
  "involved",
  "led_to",
  "implemented_by",
] as const;
export type Relation = (typeof RELATIONS)[number];

export const NODE_LABELS = [
  "Policy",
  "Process",
  "System",
  "DataClass",
  "Team",
  "Person",
  "Role",
  "Approval",
  "Control",
  "Vendor",
  "Incident",
] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

export interface GraphNode {
  id: string;
  label: NodeLabel;
  name: string;
  classification: string | null;
  description: string | null;
  source_doc: string | null;
}

export interface GraphEdge {
  source: string;
  relation: Relation;
  target: string;
  condition: string | null;
  source_doc: string | null;
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, commas and newlines in quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const orNull = (s: string | undefined) => (s && s.length ? s : null);

export async function readGraphSeed(dir = "data/graph_seed") {
  const nodes = parseCsv(await readFile(path.join(dir, "nodes.csv"), "utf8")).map(
    (r): GraphNode => {
      if (!NODE_LABELS.includes(r.label as NodeLabel)) {
        throw new Error(`Node ${r.id}: unknown label ${r.label}`);
      }
      return {
        id: r.id,
        label: r.label as NodeLabel,
        name: r.name,
        classification: orNull(r.classification),
        description: orNull(r.description),
        source_doc: orNull(r.source_doc),
      };
    },
  );
  const ids = new Set(nodes.map((n) => n.id));
  const edges = parseCsv(await readFile(path.join(dir, "edges.csv"), "utf8")).map(
    (r, i): GraphEdge => {
      if (!RELATIONS.includes(r.relation as Relation)) {
        throw new Error(
          `Edge ${i + 2}: relation "${r.relation}" is not one of the ${RELATIONS.length} relations`,
        );
      }
      if (!ids.has(r.source) || !ids.has(r.target)) {
        throw new Error(`Edge ${i + 2}: unknown node ${ids.has(r.source) ? r.target : r.source}`);
      }
      return {
        source: r.source,
        relation: r.relation as Relation,
        target: r.target,
        condition: orNull(r.condition),
        source_doc: orNull(r.source_doc),
      };
    },
  );
  return { nodes, edges };
}

/** Replace the graph tables from the seed in one transaction (66 nodes, 121 edges). */
export async function loadGraph(pool: Pool, seed: Awaited<ReturnType<typeof readGraphSeed>>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM edges");
    await client.query("DELETE FROM nodes");
    for (const n of seed.nodes) {
      await client.query(
        "INSERT INTO nodes (id, label, name, classification, description, source_doc) VALUES ($1,$2,$3,$4,$5,$6)",
        [n.id, n.label, n.name, n.classification, n.description, n.source_doc],
      );
    }
    for (const e of seed.edges) {
      await client.query(
        "INSERT INTO edges (source, relation, target, condition, source_doc) VALUES ($1,$2,$3,$4,$5)",
        [e.source, e.relation, e.target, e.condition, e.source_doc],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`Graph load failed: ${(err as Error).message}`);
  } finally {
    client.release();
  }
  return { nodes: seed.nodes.length, edges: seed.edges.length };
}
