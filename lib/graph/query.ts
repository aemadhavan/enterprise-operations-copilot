import { z } from "zod";
import { sql } from "@/lib/db/client";
import { NODE_LABELS, RELATIONS } from "./load";

/** graph_query input (contracts/mcp-tools.md, FR-005b, ADR-005). */
export const GraphQueryInput = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("node"),
    start_id: z.string(),
    max_hops: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
    relations: z.array(z.enum(RELATIONS)).optional(),
  }),
  z.strictObject({
    mode: z.literal("label"),
    label: z.enum(NODE_LABELS),
    classification: z.enum(["Public", "Internal", "Confidential", "Restricted"]).optional(),
    condition: z.string().optional(),
  }),
  z.strictObject({
    mode: z.literal("relation"),
    relation: z.enum(RELATIONS),
    limit: z.number().int().min(1).max(200).optional(),
  }),
]);
export type GraphQueryInput = z.infer<typeof GraphQueryInput>;

export interface QNode {
  id: string;
  label: string;
  name: string;
  classification: string | null;
  description: string | null;
  source_doc: string | null;
}
export interface QEdge {
  source: string;
  relation: string;
  target: string;
  condition: string | null;
  source_doc: string;
}
export interface GraphQueryResult {
  nodes: QNode[];
  edges: QEdge[];
}

async function nodesFor(ids: string[]): Promise<QNode[]> {
  if (!ids.length) return [];
  return (await sql`SELECT id, label, name, classification, description, source_doc
    FROM nodes WHERE id = ANY(${ids}::text[]) ORDER BY id`) as QNode[];
}

function withNodes(edges: QEdge[], extra: string[] = []) {
  const ids = [...new Set([...extra, ...edges.flatMap((e) => [e.source, e.target])])];
  return nodesFor(ids).then((nodes) => ({ nodes, edges }));
}

/**
 * Three seed modes (FR-005b), each a parameterised query; every edge carries source_doc.
 * - node: from `start_id`, follow edges outward up to `max_hops` (default 2, ≤ 4), optionally
 *   only the listed relations, plus the edges pointing into the seed (e.g. processes that
 *   `uses` a system). Walking further backwards is avoided, so a contractor seed doesn't
 *   pull in the employee chain.
 * - label: all nodes with `label` (optionally one `classification`) and their outgoing edges,
 *   optionally only edges whose condition contains `condition`.
 * - relation: all edges of one relation (limit, default 100).
 */
export async function graphQuery(input: GraphQueryInput): Promise<GraphQueryResult> {
  const q = GraphQueryInput.parse(input);

  if (q.mode === "node") {
    const hops = q.max_hops ?? 2;
    const rels: string[] | null = q.relations?.length ? q.relations : null;
    const edges = (await sql`
      WITH RECURSIVE walk(node, depth) AS (
        SELECT ${q.start_id}::text, 0
        UNION
        SELECT e.target, w.depth + 1
        FROM walk w JOIN edges e ON e.source = w.node
        WHERE w.depth < ${hops} AND (${rels}::text[] IS NULL OR e.relation = ANY(${rels}::text[]))
      ),
      reached AS (SELECT node, min(depth) AS depth FROM walk GROUP BY node)
      SELECT DISTINCT e.source, e.relation, e.target, e.condition, e.source_doc
      FROM edges e
      WHERE (
          e.source IN (SELECT node FROM reached WHERE depth < ${hops})
          AND (${rels}::text[] IS NULL OR e.relation = ANY(${rels}::text[]))
        )
        OR (e.target = ${q.start_id} AND (${rels}::text[] IS NULL OR e.relation = ANY(${rels}::text[])))
      ORDER BY e.source, e.relation, e.target`) as QEdge[];
    return withNodes(edges, [q.start_id]);
  }

  if (q.mode === "label") {
    const cls = q.classification ?? null;
    const cond = q.condition ?? null;
    const seeds = (await sql`SELECT id FROM nodes
      WHERE label = ${q.label} AND (${cls}::text IS NULL OR classification = ${cls})
      ORDER BY id`) as { id: string }[];
    const ids = seeds.map((s) => s.id);
    const edges = (await sql`
      SELECT source, relation, target, condition, source_doc FROM edges
      WHERE source = ANY(${ids}::text[])
        AND (${cond}::text IS NULL OR condition ILIKE '%' || ${cond} || '%')
      ORDER BY source, relation, target`) as QEdge[];
    return withNodes(edges, ids);
  }

  const limit = q.limit ?? 100;
  const edges = (await sql`
    SELECT source, relation, target, condition, source_doc FROM edges
    WHERE relation = ${q.relation} ORDER BY source, target LIMIT ${limit}`) as QEdge[];
  return withNodes(edges);
}
