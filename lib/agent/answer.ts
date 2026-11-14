import type { Citation, Claim, Confidence, FinalAnswer } from "./schemas";

/** What was actually retrieved this turn: chunks (doc + section) and graph edges. */
export interface RetrievedSet {
  chunks: { doc_id: string; section: string; is_authoritative: boolean }[];
  edges: { source: string; relation: string; target: string; source_doc: string | null }[];
}

const edgeKey = (e: { source: string; relation: string; target: string }) =>
  `${e.source}|${e.relation}|${e.target}`;

const normalise = (s: string) => s.replace(/^§\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The section's own number: "3. Requirements > 3.4" → "3.4"; "1. Scope" → "1". */
const sectionNumber = (section: string) => {
  const last = section.split(" > ").pop() ?? section;
  return last.match(/^(\d+(?:\.\d+)*)/)?.[1] ?? null;
};

/** Find the retrieved section a cited section refers to (full path, last segment or number). */
function matchSection(docSections: string[], cited: string): string | null {
  if (docSections.includes("*")) return cited.replace(/^§\s*/, "").trim() || "1";
  const c = normalise(cited);
  const cNum = c.match(/^(\d+(?:\.\d+)*)\.?$/)?.[1] ?? null;
  for (const s of docSections) {
    const n = normalise(s);
    if (n === c || normalise(s.split(" > ").pop() ?? "") === c) return s;
  }
  if (cNum) for (const s of docSections) if (sectionNumber(s) === cNum) return s;
  return null;
}

/**
 * Drop any citation not in this turn's retrieved set and canonicalise section names
 * (answer-schema.md post-processing step 1). Duplicates after canonicalisation collapse.
 */
export function filterCitations(
  answer: FinalAnswer,
  retrieved: RetrievedSet,
): FinalAnswer & { dropped: number } {
  const sectionsByDoc = new Map<string, string[]>();
  for (const c of retrieved.chunks) {
    sectionsByDoc.set(c.doc_id, [...(sectionsByDoc.get(c.doc_id) ?? []), c.section]);
  }
  const edges = new Map(retrieved.edges.map((e) => [edgeKey(e), e]));
  let dropped = 0;

  const claims = answer.claims.map((claim) => {
    const kept: Citation[] = [];
    const seen = new Set<string>();
    for (const cit of claim.citations) {
      let canonical: Citation | null = null;
      if ("edge" in cit) {
        if (edges.has(edgeKey(cit.edge))) canonical = cit;
      } else {
        const s = matchSection(sectionsByDoc.get(cit.doc_id) ?? [], cit.section);
        if (s) canonical = { doc_id: cit.doc_id, section: s };
      }
      if (!canonical) {
        dropped++;
        continue;
      }
      const key = JSON.stringify(canonical);
      if (!seen.has(key)) {
        seen.add(key);
        kept.push(canonical);
      }
    }
    return { ...claim, citations: kept };
  });
  return { ...answer, claims, dropped };
}

/**
 * Confidence (answer-schema.md step 2, clarification 3):
 * low  — any key claim uncited, a key claim's citations conflict (effective policy and
 *        meeting/proposal material cited together), a key claim resting only on
 *        proposal_or_meeting, or no key claims at all;
 * medium — assumptions or gaps non-empty; high otherwise.
 * Call after filterCitations so only retrieved citations count.
 */
export function computeConfidence(answer: FinalAnswer, retrieved: RetrievedSet): Confidence {
  const authoritative = new Map(retrieved.chunks.map((c) => [c.doc_id, c.is_authoritative]));
  const key = answer.claims.filter((c) => c.key);
  if (key.length === 0) return "low";

  const isLow = (c: Claim) => {
    if (c.citations.length === 0) return true;
    if (c.source_status === "proposal_or_meeting") return true;
    const docStatus = c.citations.flatMap((cit) =>
      "edge" in cit ? [] : [authoritative.get(cit.doc_id) ?? true],
    );
    const mixed = docStatus.includes(true) && docStatus.includes(false);
    const onlyNonAuthoritative = docStatus.length > 0 && docStatus.every((s) => !s);
    return mixed || onlyNonAuthoritative;
  };
  if (key.some(isLow)) return "low";
  if (answer.assumptions.length || answer.gaps.length) return "medium";
  return "high";
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const chip = (c: Citation) =>
  "edge" in c
    ? `\`${c.edge.source} -${c.edge.relation}-> ${c.edge.target} (${c.edge.source_doc})\``
    : `\`${c.doc_id} §${sectionNumber(c.section) ?? c.section}\``;

/** Markdown from claims with citation chips; all model text is HTML-escaped (LLM05). */
export function renderMarkdown(answer: FinalAnswer): string {
  const lines: string[] = [];
  if (answer.behaviour === "clarify" && answer.clarifying_question) {
    lines.push(escapeHtml(answer.clarifying_question));
  }
  for (const c of answer.claims) {
    const chips = c.citations.map(chip).join(" ");
    const note =
      c.source_status === "proposal_or_meeting"
        ? " _(proposal / meeting note, not policy in force)_"
        : "";
    lines.push(`- ${escapeHtml(c.text)}${note}${chips ? ` ${chips}` : ""}`);
  }
  if (answer.behaviour === "refuse" && answer.legitimate_path) {
    lines.push("", `**Legitimate path:** ${escapeHtml(answer.legitimate_path)}`);
  }
  if (answer.assumptions.length) {
    lines.push("", "**Assumptions**", ...answer.assumptions.map((a) => `- ${escapeHtml(a)}`));
  }
  if (answer.gaps.length) {
    lines.push("", "**Gaps**", ...answer.gaps.map((g) => `- ${escapeHtml(g)}`));
  }
  return lines.join("\n");
}
