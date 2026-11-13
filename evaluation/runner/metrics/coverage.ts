import { retrievedDocSet } from "./recall";

/**
 * Source coverage (reported, not gated): |expected ∩ retrieved| ÷ |expected|, uncapped.
 * Same retrieved set as recall@5 (top 5 distinct docs + graph edge/node source_docs), but
 * without recall@5's min(5, |expected|) denominator, so a case expecting 6 sources and
 * finding 5 shows 83%, not 100%. Null when the case expects no sources.
 */
export function sourceCoverage(
  expectedSources: string[],
  ranked: { doc_id: string }[],
  graphItems: { source_doc: string | null }[] = [],
): number | null {
  const expected = [...new Set(expectedSources)];
  if (expected.length === 0) return null;
  const retrieved = retrievedDocSet(ranked, graphItems);
  return expected.filter((s) => retrieved.has(s)).length / expected.length;
}
