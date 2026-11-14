import { sql } from "@/lib/db/client";
import { createEmbedder, toVectorLiteral, type Embedder } from "./embed";

/** Arm depth and RRF constant (R-07). */
export const ARM_LIMIT = 20;
export const RRF_K = 60;

export interface Fused {
  id: string;
  score: number;
  ranks: (number | null)[]; // 1-based rank in each input list, null if absent
}

/** Reciprocal rank fusion: score(id) = Σ 1 / (k + rank). Ties: best rank, then id. */
export function reciprocalRankFusion(lists: string[][], k = RRF_K): Fused[] {
  const byId = new Map<string, Fused>();
  lists.forEach((list, li) => {
    list.forEach((id, i) => {
      const f = byId.get(id) ?? { id, score: 0, ranks: lists.map(() => null) };
      f.score += 1 / (k + i + 1);
      f.ranks[li] = i + 1;
      byId.set(id, f);
    });
  });
  const best = (f: Fused) => Math.min(...f.ranks.map((r) => r ?? Infinity));
  return [...byId.values()].sort(
    (a, b) => b.score - a.score || best(a) - best(b) || a.id.localeCompare(b.id),
  );
}

export interface SearchResult {
  chunk_id: string;
  doc_id: string;
  section: string;
  text: string;
  score: number;
  fts_rank: number | null;
  vector_rank: number | null;
  title: string;
  doc_type: string;
  version: string | null;
  owner: string | null;
  effective_date: string | null;
  is_authoritative: boolean;
}

/**
 * Hybrid retrieval (FR-004, R-07): Postgres full-text as an OR query over the meaningful
 * words (`plainto_tsquery` strips stop words and stems; `&` becomes `|`), ranked with
 * `ts_rank_cd(tsv, q, 2)` (length-normalised), top 20 + pgvector cosine, top 20, fused with RRF (k = 60).
 * `arms` runs one arm alone ("fts" | "vector") for evaluation; the default is both.
 * Returns up to `k` chunks, best first, with document metadata.
 */
export type SearchArms = "hybrid" | "fts" | "vector";

async function ftsIds(query: string): Promise<string[]> {
  const rows = await sql`
    SELECT id::text FROM chunks,
      to_tsquery('english', replace(plainto_tsquery('english', ${query})::text, ' & ', ' | ')) q
    WHERE tsv @@ q ORDER BY ts_rank_cd(tsv, q, 2) DESC, id LIMIT ${ARM_LIMIT}`;
  return (rows as { id: string }[]).map((r) => r.id);
}

async function vectorIds(query: string, embedder: Embedder): Promise<string[]> {
  try {
    const vector = toVectorLiteral(await embedder.embedQuery(query));
    const rows = await sql`
      SELECT id::text FROM chunks WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vector}::vector, id LIMIT ${ARM_LIMIT}`;
    return (rows as { id: string }[]).map((r) => r.id);
  } catch (err) {
    const status =
      (err as { statusCode?: number; status?: number }).statusCode ??
      (err as { status?: number }).status;
    if (status === 429) return [];
    throw err;
  }
}

export async function hybridSearch(
  query: string,
  opts: { k?: number; embedder?: Embedder; arms?: SearchArms } = {},
): Promise<SearchResult[]> {
  const k = opts.k ?? ARM_LIMIT;
  const arms = opts.arms ?? "hybrid";
  const [fts, vec] = await Promise.all([
    arms === "vector" ? Promise.resolve([]) : ftsIds(query),
    arms === "fts" ? Promise.resolve([]) : vectorIds(query, opts.embedder ?? createEmbedder()),
  ]);
  const fused = reciprocalRankFusion([fts, vec]).slice(0, k);
  if (!fused.length) return [];

  const rows = (await sql`
    SELECT c.id::text AS chunk_id, c.doc_id, c.section, c.text, d.title, d.doc_type, d.version,
           d.owner, to_char(d.effective_date, 'YYYY-MM-DD') AS effective_date, d.is_authoritative
    FROM chunks c JOIN documents d USING (doc_id)
    WHERE c.id = ANY(${fused.map((f) => f.id)}::bigint[])`) as Omit<
    SearchResult,
    "score" | "fts_rank" | "vector_rank"
  >[];
  const byId = new Map(rows.map((r) => [r.chunk_id, r]));

  return fused.flatMap((f) => {
    const r = byId.get(f.id);
    return r ? [{ ...r, score: f.score, fts_rank: f.ranks[0], vector_rank: f.ranks[1] }] : [];
  });
}

/** Distinct doc IDs in rank order (recall@5 uses the first five; clarification 1). */
export function distinctDocIds(results: Pick<SearchResult, "doc_id">[]): string[] {
  return [...new Set(results.map((r) => r.doc_id))];
}
