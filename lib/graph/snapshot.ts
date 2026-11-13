import { sql } from "@/lib/db/client";
import type { Graph } from "@/lib/policy/approvals";
import type { GraphEdge, GraphNode } from "./load";

let cache: Promise<Graph> | undefined;

/** The whole graph (66 nodes), loaded once per process for the approval resolver (FR-009). */
export function loadGraphSnapshot(): Promise<Graph> {
  cache ??= (async () => {
    const [nodes, edges] = await Promise.all([
      sql`SELECT id, label, name, classification, description, source_doc FROM nodes ORDER BY id`,
      sql`SELECT source, relation, target, condition, source_doc FROM edges
          ORDER BY source, relation, target`,
    ]);
    return { nodes: nodes as GraphNode[], edges: edges as GraphEdge[] };
  })().catch((e) => {
    cache = undefined;
    throw e;
  });
  return cache;
}
