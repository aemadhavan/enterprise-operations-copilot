import { conditionApplies, highestClassification } from "@/lib/graph/conditions";
import type { GraphEdge, GraphNode } from "@/lib/graph/load";

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type RequesterType = "Employee" | "Contractor" | "Vendor";
export type AccessLevel = "read" | "write" | "admin";

export type ApprovalRole =
  | "line_manager"
  | "data_owner"
  | "security_governance"
  | "head_of_security_governance"
  | "privacy_officer"
  | "finance_systems_lead";

/** PRC-012 §3 order, with the admin and payment-card extras placed after their nearest step. */
const ORDER: { id: string; role: ApprovalRole }[] = [
  { id: "APR-LM", role: "line_manager" },
  { id: "APR-DO", role: "data_owner" },
  { id: "APR-SEC", role: "security_governance" },
  { id: "APR-HEADSEC", role: "head_of_security_governance" },
  { id: "APR-PRIV", role: "privacy_officer" },
  { id: "APR-FINSYS", role: "finance_systems_lead" },
];

export interface ChainStep {
  seq: number;
  role: ApprovalRole;
  approval_id: string;
  approver_name: string | null;
  source_doc: string;
}
export interface Requirement {
  id: string;
  name: string;
  source_doc: string;
}
export interface ApprovalResolution {
  system_id: string;
  classification: string | null;
  chain: ChainStep[];
  controls: Requirement[]; // from the data classes the system stores
  prerequisites: Requirement[]; // from the requester's role (POL-022 for contractors)
}

/**
 * Resolve the REF-005 approval chain, controls and prerequisites for one request (FR-009).
 * Line manager = the stated sponsor; data owner = the system's `data_owner` edge (REF-003);
 * other approvers via `approved_by`. Vendor staff are treated as contractors (POL-022).
 */
export function resolveApprovals(
  graph: Graph,
  req: {
    system_id: string;
    requester_type: RequesterType;
    access_level: AccessLevel;
    sponsor?: string | null;
  },
): ApprovalResolution {
  const node = new Map(graph.nodes.map((n) => [n.id, n]));
  const system = node.get(req.system_id);
  if (!system || system.label !== "System") throw new Error(`Unknown system ${req.system_id}`);

  const out = (id: string, relation: string) =>
    graph.edges.filter((e) => e.source === id && e.relation === relation);
  const stored = out(system.id, "stores").map((e) => e.target);
  const classification =
    system.classification ?? highestClassification(stored.map((d) => node.get(d)?.classification));
  const requester = req.requester_type === "Vendor" ? "Contractor" : req.requester_type;
  const ctx = { classification, requester };

  const roleId = requester === "Contractor" ? "ROLE-CONTRACTOR" : "ROLE-EMP";
  const requirementEdges = [
    ...out(roleId, "requires"),
    ...(req.access_level === "admin" ? out("ROLE-PRIV-ADMIN", "requires") : []),
  ].filter((e) => conditionApplies(e.condition, ctx));
  const dataClassEdges = stored
    .flatMap((d) => out(d, "requires"))
    .filter((e) => conditionApplies(e.condition, ctx));

  // Approvals: role/admin requirements plus data-class approvals (e.g. DC-PAY → APR-FINSYS).
  const approvalSource = new Map<string, string>();
  for (const e of [...requirementEdges, ...dataClassEdges]) {
    if (e.target.startsWith("APR-") && !approvalSource.has(e.target)) {
      approvalSource.set(e.target, e.source_doc ?? "REF-005");
    }
  }
  const dataOwnerEdge = out(system.id, "data_owner")[0];
  const chain: ChainStep[] = ORDER.filter((o) => approvalSource.has(o.id)).map((o, i) => {
    let approver_name: string | null = null;
    let source_doc = approvalSource.get(o.id)!;
    if (o.id === "APR-LM") approver_name = req.sponsor ?? null;
    else if (o.id === "APR-DO") {
      approver_name = dataOwnerEdge ? (node.get(dataOwnerEdge.target)?.name ?? null) : null;
      source_doc = dataOwnerEdge?.source_doc ?? source_doc;
    } else {
      const by = out(o.id, "approved_by")[0];
      approver_name = by ? (node.get(by.target)?.name ?? null) : null;
    }
    return { seq: i + 1, role: o.role, approval_id: o.id, approver_name, source_doc };
  });

  const toRequirements = (edges: GraphEdge[]) => {
    const seen = new Map<string, Requirement>();
    for (const e of edges) {
      if (!e.target.startsWith("CTL-") || seen.has(e.target)) continue;
      seen.set(e.target, {
        id: e.target,
        name: node.get(e.target)?.name ?? e.target,
        source_doc: e.source_doc ?? "REF-004",
      });
    }
    return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  };

  return {
    system_id: system.id,
    classification,
    chain,
    controls: toRequirements(dataClassEdges),
    prerequisites: toRequirements(requirementEdges.filter((e) => e.source === roleId)),
  };
}
