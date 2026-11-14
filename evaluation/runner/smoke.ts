// Manual smoke script for US1 text-route answering (T022):
// Runs GS-001 (direct policy lookup), GS-017 (proposal vs effective policy, FR-008),
// and GS-019 (knowledge base gap, FR-007) and prints answer + confidence.
// Calls the chat model, so it is not part of Tier 1a and is not gated in CI.
//
// Usage:
//   pnpm tsx evaluation/runner/smoke.ts [--cases GS-001,GS-017,GS-019]
import { pathToFileURL } from "node:url";
import "../../scripts/_env";
import { answerTextRoute } from "@/lib/agent/text-route";
import { closePool } from "@/lib/db/client";
import { expandCaseRanges, loadGoldenSet } from "./cli";

export const DEFAULT_SMOKE_CASES = ["GS-001", "GS-017", "GS-019"];

export function parseSmokeCases(argv: string[]): string[] {
  const idx = argv.indexOf("--cases");
  if (idx !== -1 && argv[idx + 1]) {
    return expandCaseRanges(argv[idx + 1]);
  }
  return DEFAULT_SMOKE_CASES;
}

export async function runSmoke(caseIds = DEFAULT_SMOKE_CASES) {
  const { cases } = loadGoldenSet();
  const selected = cases.filter((c) => caseIds.includes(c.id));
  const results = [];

  for (const c of selected) {
    const t0 = performance.now();
    const res = await answerTextRoute(c.question);
    const ms = Math.round(performance.now() - t0);
    const behaviourMatch = res.answer.behaviour === c.expected_behaviour;

    console.log(`\n=== ${c.id} (${c.category}) ===`);
    console.log(`Question:   ${c.question}`);
    console.log(
      `Behaviour:  ${res.answer.behaviour} (expected: ${c.expected_behaviour}) ${behaviourMatch ? "✓" : "✗"}`,
    );
    console.log(`Confidence: ${res.confidence}`);
    console.log(`Latency:    ${ms} ms · Dropped citations: ${res.dropped_citations}`);
    console.log(`Answer:\n${res.markdown}`);

    results.push({
      id: c.id,
      question: c.question,
      behaviour: res.answer.behaviour,
      expected_behaviour: c.expected_behaviour,
      confidence: res.confidence,
      markdown: res.markdown,
      latency_ms: ms,
    });
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runSmoke(parseSmokeCases(process.argv.slice(2)))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
