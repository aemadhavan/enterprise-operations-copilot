/**
 * Retrieval recall@5 (SC-010, clarification 1).
 *
 * Retrieved set = the first 5 *distinct* doc IDs in the ranked chunk list, plus every
 * `source_doc` of a returned graph edge (graph routes only).
 * Score = |expected ∩ retrieved| ÷ min(5, |expected|), capped at 1.
 * Cases with no expected sources are skipped (null), not scored as 0 or 1.
 */
export function retrievedDocSet(
  ranked: { doc_id: string }[],
  edges: { source_doc: string | null }[] = [],
): Set<string> {
  const docs: string[] = [];
  for (const r of ranked) {
    if (!docs.includes(r.doc_id)) docs.push(r.doc_id);
    if (docs.length === 5) break;
  }
  const set = new Set(docs);
  for (const e of edges) if (e.source_doc) set.add(e.source_doc);
  return set;
}

export function recallAt5(
  expectedSources: string[],
  ranked: { doc_id: string }[],
  edges: { source_doc: string | null }[] = [],
): number | null {
  const expected = [...new Set(expectedSources)];
  if (expected.length === 0) return null;
  const retrieved = retrievedDocSet(ranked, edges);
  const found = expected.filter((s) => retrieved.has(s)).length;
  return Math.min(1, found / Math.min(5, expected.length));
}
