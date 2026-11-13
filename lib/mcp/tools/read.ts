import { z } from "zod";
import { sql } from "@/lib/db/client";
import { NODE_LABELS, RELATIONS, type GraphEdge } from "@/lib/graph/load";
import { graphQuery, GraphQueryInput, type GraphQueryResult } from "@/lib/graph/query";
import { loadGraphSnapshot } from "@/lib/graph/snapshot";
import { resolveApprovals, type Graph } from "@/lib/policy/approvals";
import { hybridSearch, type SearchResult } from "@/lib/retrieval/hybrid";
import { defineTool } from "../registry";

/**
 * Read tools (contracts/mcp-tools.md, FR-014). Input schemas are flat strict objects so they
 * work as `strict: true` Anthropic tool schemas (a top-level union is not allowed); handlers
 * map them onto the library inputs and re-validate.
 */

export interface ReadToolDeps {
  search: (q: string, k: number) => Promise<SearchResult[]>;
  section: (doc_id: string, section: string) => Promise<SectionResult | null>;
  graph: (input: GraphQueryInput) => Promise<GraphQueryResult>;
  snapshot: () => Promise<Graph>;
}

export interface SectionResult {
  doc_id: string;
  section: string;
  text: string;
  version: string | null;
  effective_date: string | null;
  is_authoritative: boolean;
}

/** Exact section path, else its last segment, else the clause number prefix (e.g. "3.4"). */
async function getSection(doc_id: string, section: string): Promise<SectionResult | null> {
  const s = section.replace(/^§\s*/, "").trim();
  const rows = (await sql`
    SELECT c.doc_id, c.section, c.text, d.version,
           to_char(d.effective_date, 'YYYY-MM-DD') AS effective_date, d.is_authoritative,
           CASE WHEN c.section = ${s} THEN 0
                WHEN c.section LIKE '% > ' || ${s} THEN 1
                ELSE 2 END AS rank
    FROM chunks c JOIN documents d USING (doc_id)
    WHERE c.doc_id = ${doc_id}
      AND (c.section = ${s} OR c.section LIKE '% > ' || ${s}
           OR c.section LIKE ${s} || '%' OR c.section LIKE '% > ' || ${s} || ' %')
    ORDER BY rank, c.id LIMIT 6`) as (SectionResult & { rank: number })[];
  if (!rows.length) return null;
  const best = rows.filter((r) => r.rank === rows[0].rank);
  const { rank: _r, ...first } = best[0];
  void _r;
  return { ...first, text: best.map((r) => r.text).join("\n\n") };
}

export const defaultReadDeps: ReadToolDeps = {
  search: (q, k) => hybridSearch(q, { k }),
  section: getSection,
  graph: graphQuery,
  snapshot: loadGraphSnapshot,
};

export const SearchDocumentsInput = z.strictObject({
  query: z.string().min(1).describe("Natural-language search query"),
  k: z.number().int().min(1).max(10).optional().describe("Number of chunks, default 8"),
  mode: z.enum(["baseline", "graphrag"]).optional(),
});

export const GetSectionInput = z.strictObject({
  doc_id: z.string().describe("Document ID, e.g. POL-014"),
  section: z.string().describe('Section path or number, e.g. "3. Requirements > 3.4" or "3.4"'),
});

export const GraphQueryToolInput = z.strictObject({
  mode: z
    .enum(["node", "label", "relation"])
    .describe("node = walk from start_id; label = all nodes of a label; relation = all edges"),
  start_id: z.string().optional().describe("node mode: start node ID, e.g. SYS-CRM"),
  max_hops: z.enum(["1", "2", "3", "4"]).optional().describe("node mode: default 2"),
  relations: z.array(z.enum(RELATIONS)).optional().describe("node mode: relation allow-list"),
  label: z.enum(NODE_LABELS).optional().describe("label mode"),
  classification: z.enum(["Public", "Internal", "Confidential", "Restricted"]).optional(),
  condition: z.string().optional().describe("label mode: edge condition filter"),
  relation: z.enum(RELATIONS).optional().describe("relation mode"),
  limit: z.number().int().min(1).max(200).optional(),
});

export function toGraphQueryInput(i: z.infer<typeof GraphQueryToolInput>): GraphQueryInput {
  const strip = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  if (i.mode === "node") {
    return GraphQueryInput.parse(
      strip({
        mode: "node",
        start_id: i.start_id,
        max_hops: i.max_hops ? Number(i.max_hops) : undefined,
        relations: i.relations,
      }),
    );
  }
  if (i.mode === "label") {
    return GraphQueryInput.parse(
      strip({
        mode: "label",
        label: i.label,
        classification: i.classification,
        condition: i.condition,
      }),
    );
  }
  return GraphQueryInput.parse(strip({ mode: "relation", relation: i.relation, limit: i.limit }));
}

export const LookupApprovalsInput = z.strictObject({
  system_id: z.string().describe("System node ID, e.g. SYS-CRM"),
  requester_type: z.enum(["Employee", "Contractor", "Vendor"]),
  access_level: z.enum(["read", "write", "admin"]),
  sponsor: z.string().optional().describe("Stated sponsor / line manager, if known"),
});

/** Edges that justify an approval resolution, so the answer can cite them (Constitution I). */
export function approvalEvidence(
  graph: Graph,
  req: z.infer<typeof LookupApprovalsInput>,
  approvalIds: string[],
): GraphEdge[] {
  const stored = graph.edges
    .filter((e) => e.source === req.system_id && e.relation === "stores")
    .map((e) => e.target);
  const role = req.requester_type === "Employee" ? "ROLE-EMP" : "ROLE-CONTRACTOR";
  const roles = req.access_level === "admin" ? [role, "ROLE-PRIV-ADMIN"] : [role];
  return graph.edges.filter(
    (e) =>
      (e.source === req.system_id && (e.relation === "stores" || e.relation === "data_owner")) ||
      (e.relation === "requires" && (roles.includes(e.source) || stored.includes(e.source))) ||
      (e.relation === "approved_by" && approvalIds.includes(e.source)),
  );
}

export function readTools(deps: ReadToolDeps = defaultReadDeps) {
  return [
    defineTool({
      name: "search_documents",
      description:
        "Hybrid keyword + vector search over policies, procedures, references, incidents and meeting notes. Returns ranked chunks with doc_id and section for citation.",
      risk: "read",
      allowed_roles: ["agent"],
      input: SearchDocumentsInput,
      handler: async ({ query, k }) => ({
        results: (await deps.search(query, k ?? 8)).map((r) => ({
          doc_id: r.doc_id,
          section: r.section,
          title: r.title,
          text: r.text,
          score: Number(r.score.toFixed(4)),
          doc_type: r.doc_type,
          effective_date: r.effective_date,
          status: r.is_authoritative ? "effective_policy" : "proposal_or_meeting",
        })),
      }),
    }),
    defineTool({
      name: "get_section",
      description: "Fetch the full text of one document section, for quoting and citation.",
      risk: "read",
      allowed_roles: ["agent"],
      input: GetSectionInput,
      handler: async ({ doc_id, section }) =>
        (await deps.section(doc_id, section)) ?? {
          error: { code: "not_found", message: `${doc_id} § ${section}` },
        },
    }),
    defineTool({
      name: "graph_query",
      description:
        "Traverse the governance graph (systems, data classes, controls, approvals, roles, people, vendors, incidents). Every edge carries its source_doc for citation. Modes: node (start_id + max_hops, default 2), label (+ classification / condition), relation.",
      risk: "read",
      allowed_roles: ["agent"],
      input: GraphQueryToolInput,
      handler: async (input) => deps.graph(toGraphQueryInput(input)),
    }),
    defineTool({
      name: "lookup_approvals",
      description:
        "Resolve the REF-005 approval chain (PRC-012 §3 order, named approvers where known), data-class controls and requester prerequisites for one system and requester type. Deterministic; use this for 'what approvals are required'.",
      risk: "read",
      allowed_roles: ["agent"],
      input: LookupApprovalsInput,
      handler: async (req) => {
        const graph = await deps.snapshot();
        const r = resolveApprovals(graph, req);
        return {
          ...r,
          evidence_edges: approvalEvidence(
            graph,
            req,
            r.chain.map((s) => s.approval_id),
          ),
        };
      },
    }),
  ];
}
