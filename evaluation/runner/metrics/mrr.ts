/**
 * Reciprocal rank for MRR (reported, not gated): 1 / rank of the first expected source in
 * the ranked list of distinct doc IDs (all retrieved docs, not only the top 5). 0 if none is
 * retrieved; null (skipped) when the case expects no sources. Graph edges are unranked, so
 * they don't count here.
 */
export function reciprocalRank(
  expectedSources: string[],
  ranked: { doc_id: string }[],
): number | null {
  const expected = new Set(expectedSources);
  if (expected.size === 0) return null;
  const docs = [...new Set(ranked.map((r) => r.doc_id))];
  const i = docs.findIndex((d) => expected.has(d));
  return i === -1 ? 0 : 1 / (i + 1);
}
