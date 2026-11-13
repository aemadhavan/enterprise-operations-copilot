import type { GraphNode } from "./load";

/**
 * Deterministic entity resolution: graph nodes whose ID or name appears in the text
 * (case-insensitive, word-bounded), plus requester-role words. Used for code-computed
 * risk (FR-003) and as graph seeds in Tier-1a evaluation (no model calls).
 */
const ROLE_WORDS: { pattern: RegExp; id: string }[] = [
  { pattern: /\bcontractors?\b|\bconsultants?\b/i, id: "ROLE-CONTRACTOR" },
  { pattern: /\bemployees?\b|\bstaff member\b/i, id: "ROLE-EMP" },
  { pattern: /\badmin(istrator)?\b|\bprivileged\b/i, id: "ROLE-PRIV-ADMIN" },
];

/** Node labels worth matching by name (people are matched too, e.g. "Tom Gallagher"). */
const NAMED_LABELS = new Set([
  "System",
  "DataClass",
  "Vendor",
  "Person",
  "Process",
  "Policy",
  "Incident",
]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function resolveEntities(text: string, nodes: GraphNode[]): GraphNode[] {
  const found = new Map<string, GraphNode>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const idHit = new RegExp(`(^|[^A-Za-z0-9-])${escape(n.id)}([^A-Za-z0-9-]|$)`, "i").test(text);
    const nameHit =
      NAMED_LABELS.has(n.label) &&
      n.name.length >= 4 &&
      new RegExp(`\\b${escape(n.name)}\\b`, "i").test(text);
    if (idHit || nameHit) found.set(n.id, n);
  }
  for (const r of ROLE_WORDS) {
    const n = byId.get(r.id);
    if (n && r.pattern.test(text)) found.set(n.id, n);
  }
  return [...found.values()];
}
