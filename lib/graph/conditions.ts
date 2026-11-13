/** Edge conditions are `key=value[|value]` (data/graph_seed/README.md); other text is a note. */
export type Condition =
  | { kind: "always" }
  | { kind: "filter"; key: string; values: string[] }
  | { kind: "note"; text: string };

export const CLASSIFICATIONS = ["Public", "Internal", "Confidential", "Restricted"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export function parseCondition(raw: string | null | undefined): Condition {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "always" };
  const m = s.match(/^([a-z_]+)=(.+)$/);
  if (!m) return { kind: "note", text: s };
  return {
    kind: "filter",
    key: m[1],
    values: m[2]
      .split("|")
      .map((v) => v.trim())
      .filter(Boolean),
  };
}

export interface ConditionContext {
  classification?: string | null;
  requester?: string | null;
  [key: string]: string | null | undefined;
}

/** A filter applies only when the context has that key and its value is listed. Notes always apply. */
export function conditionApplies(raw: string | null | undefined, ctx: ConditionContext): boolean {
  const c = parseCondition(raw);
  if (c.kind !== "filter") return true;
  const v = ctx[c.key];
  return v !== undefined && v !== null && c.values.includes(v);
}

/** A system's highest classification is the max over the data classes it stores (POL-001 §3). */
export function highestClassification(
  levels: (string | null | undefined)[],
): Classification | null {
  let best = -1;
  for (const l of levels) {
    const i = CLASSIFICATIONS.indexOf(l as Classification);
    if (i > best) best = i;
  }
  return best === -1 ? null : CLASSIFICATIONS[best];
}
