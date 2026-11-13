import { spawnSync } from "node:child_process";
import { distinctDocIds, hybridSearch, type SearchArms } from "@/lib/retrieval/hybrid";
import { recallAt5 } from "./metrics/recall";
import type { CaseResult, GoldenCase, Mode } from "./types";

/** Fixture validator (Tier 1a always starts here). */
export function runValidator(): { ok: boolean; output: string } {
  const python = process.platform === "win32" ? "python" : "python3";
  const r = spawnSync(python, ["scripts/validate_seed.py"], { encoding: "utf8" });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/**
 * Tier 1a retrieval: calls lib/retrieval directly, no chat model (FR-020, FR-021).
 * In M2 both modes run hybrid text retrieval; `graphrag` adds graph edges from T025 on.
 */
export async function runRetrieval(
  cases: GoldenCase[],
  modes: Mode[],
  arms: SearchArms[],
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    for (const mode of modes) {
      for (const arm of arms) {
        const started = performance.now();
        const ranked = await hybridSearch(c.question, { arms: arm });
        const latency_ms = Math.round(performance.now() - started);
        const edges: { source_doc: string | null }[] = []; // graph edges arrive with T025
        results.push({
          case_id: c.id,
          mode,
          arm,
          recall_at_5: recallAt5(c.expected_sources, ranked, edges),
          retrieved_docs: distinctDocIds(ranked).slice(0, 5),
          expected_sources: c.expected_sources,
          latency_ms,
        });
      }
    }
  }
  return results;
}
