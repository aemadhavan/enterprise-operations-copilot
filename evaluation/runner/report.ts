import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CaseResult, Milestone, Mode } from "./types";

export const RESULTS_DIR = "evaluation/results";
export const LAST_PASS = path.join(RESULTS_DIR, "last-pass.json");

/** Tier-1a gates by milestone (spec §6). Later milestones add SC-006 etc. */
const GATES: Record<Milestone, { metric: "recall_at_5"; threshold: number; sc: string }[]> = {
  M2: [{ metric: "recall_at_5", threshold: 0.9, sc: "SC-010" }],
  M3: [{ metric: "recall_at_5", threshold: 0.9, sc: "SC-010" }],
  M4: [{ metric: "recall_at_5", threshold: 0.9, sc: "SC-010" }],
  M5: [{ metric: "recall_at_5", threshold: 0.9, sc: "SC-010" }],
};

type Scored = Pick<CaseResult, "case_id" | "mode" | "arm" | "recall_at_5">;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Mean recall per mode; only the hybrid arm is gated. Skipped (null) cases are excluded. */
export function evaluateGates(milestone: Milestone, results: Scored[]) {
  const gates = GATES[milestone].flatMap((g) => {
    const modes = [...new Set(results.map((r) => r.mode))];
    return modes.map((mode) => {
      const vals = results
        .filter((r) => r.mode === mode && r.arm === "hybrid" && r.recall_at_5 !== null)
        .map((r) => r.recall_at_5 as number);
      const value = mean(vals);
      return {
        ...g,
        mode,
        value,
        cases: vals.length,
        passed: vals.length > 0 && value >= g.threshold,
      };
    });
  });
  return { passed: gates.every((g) => g.passed), gates };
}

/** "Don't start the next task while a previously passing case is failing" (CLAUDE.md). */
export function findRegressions(last: Record<string, number>, results: Scored[]) {
  return results
    .filter((r) => r.arm === "hybrid" && r.recall_at_5 !== null)
    .flatMap((r) => {
      const key = `${r.case_id}|${r.mode}`;
      const previous = last[key];
      return previous !== undefined && (r.recall_at_5 as number) < previous
        ? [{ key, previous, current: r.recall_at_5 as number }]
        : [];
    });
}

export async function readLastPass(): Promise<Record<string, number>> {
  try {
    return (JSON.parse(await readFile(LAST_PASS, "utf8")) as { scores: Record<string, number> })
      .scores;
  } catch {
    return {};
  }
}

export interface RunMeta {
  timestamp: string;
  tier: string;
  milestone: Milestone;
  modes: Mode[];
  arms: string[];
  cases: string[];
  dataset_hash: string;
  embedding_model: string;
  models: Record<string, string>;
  graph: string;
  duration_ms: number;
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `${Math.round(v * 100)}%`;

/** Write `<ts>-1a-<mode>.jsonl` per mode, `summary.md`, and update last-pass.json on a pass. */
export async function writeReport(
  meta: RunMeta,
  results: CaseResult[],
  gate: ReturnType<typeof evaluateGates>,
  regressions: ReturnType<typeof findRegressions>,
  opts: { updateLastPass: boolean },
) {
  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = meta.timestamp.replace(/[:.]/g, "-");
  const files: string[] = [];
  for (const mode of meta.modes) {
    const file = path.join(RESULTS_DIR, `${stamp}-${meta.tier}-${mode}.jsonl`);
    const lines = [
      JSON.stringify({ type: "meta", ...meta, mode }),
      ...results.filter((r) => r.mode === mode).map((r) => JSON.stringify({ type: "case", ...r })),
      JSON.stringify({ type: "gate", ...gate, regressions }),
    ];
    await writeFile(file, lines.join("\n") + "\n");
    files.push(file);
  }

  const arms = meta.arms;
  const rr = (v: number | null | undefined) =>
    v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(2);
  const header =
    `| Case | Mode | ${arms.map((a) => `recall@5 ${a}`).join(" | ")} | ` +
    `${arms.map((a) => `coverage ${a}`).join(" | ")} | ` +
    `${arms.map((a) => `RR ${a}`).join(" | ")} | Expected | Top-5 docs (hybrid) |`;
  const sep = `|${"---|".repeat(3 * arms.length + 4)}`;
  const rows = meta.cases.flatMap((id) =>
    meta.modes.map((mode) => {
      const by = (arm: string) =>
        results.find((r) => r.case_id === id && r.mode === mode && r.arm === arm);
      const h = by("hybrid") ?? by(arms[0]);
      return (
        `| ${id} | ${mode} | ${arms.map((a) => pct(by(a)?.recall_at_5)).join(" | ")} | ` +
        `${arms.map((a) => pct(by(a)?.source_coverage)).join(" | ")} | ` +
        `${arms.map((a) => rr(by(a)?.reciprocal_rank)).join(" | ")} | ` +
        `${(h?.expected_sources ?? []).join(", ")} | ${(h?.retrieved_docs ?? []).join(", ")} |`
      );
    }),
  );
  type MetricKey = "recall_at_5" | "reciprocal_rank" | "source_coverage";
  const meanOf = (mode: string, arm: string, key: MetricKey) =>
    mean(
      results
        .filter((r) => r.mode === mode && r.arm === arm && r[key] !== null && r[key] !== undefined)
        .map((r) => r[key] as number),
    );
  const means = meta.modes.map(
    (mode) =>
      `| **mean** | ${mode} | ${arms.map((a) => pct(meanOf(mode, a, "recall_at_5"))).join(" | ")} | ` +
      `${arms.map((a) => pct(meanOf(mode, a, "source_coverage"))).join(" | ")} | ` +
      `${arms.map((a) => rr(meanOf(mode, a, "reciprocal_rank"))).join(" | ")} | | |`,
  );
  const mrrTable = [
    "## Reported metrics (not gated)",
    "",
    `| Mode | ${arms.map((a) => `recall@5 ${a}`).join(" | ")} | ${arms.map((a) => `coverage ${a}`).join(" | ")} | ${arms.map((a) => `MRR ${a}`).join(" | ")} |`,
    `|${"---|".repeat(3 * arms.length + 1)}`,
    ...meta.modes.map(
      (mode) =>
        `| ${mode} | ${arms.map((a) => pct(meanOf(mode, a, "recall_at_5"))).join(" | ")} | ` +
        `${arms.map((a) => pct(meanOf(mode, a, "source_coverage"))).join(" | ")} | ` +
        `${arms.map((a) => rr(meanOf(mode, a, "reciprocal_rank"))).join(" | ")} |`,
    ),
    "",
    "recall@5 (gated) = found ÷ min(5, expected). Coverage = found ÷ expected, uncapped, same retrieved set.",
    "MRR = mean of 1 / rank of the first expected source among distinct retrieved doc IDs.",
    "",
  ];
  const md = [
    `# Eval summary: Tier ${meta.tier}, ${meta.milestone}`,
    "",
    `Run ${meta.timestamp} · ${meta.cases.length} cases · ${(meta.duration_ms / 1000).toFixed(1)} s · embedding ${meta.embedding_model} · dataset ${meta.dataset_hash.slice(0, 12)} · graph: ${meta.graph}`,
    "",
    "## Gates",
    "",
    "| SC | Metric | Mode | Value | Threshold | Cases | Result |",
    "|---|---|---|---|---|---|---|",
    ...gate.gates.map(
      (g) =>
        `| ${g.sc} | ${g.metric} (hybrid) | ${g.mode} | ${pct(g.value)} | ${pct(g.threshold)} | ${g.cases} | ${g.passed ? "✅ pass" : "❌ fail"} |`,
    ),
    "",
    regressions.length
      ? `**Regressions vs last pass:** ${regressions.map((r) => `${r.key} ${pct(r.previous)} → ${pct(r.current)}`).join("; ")}`
      : "No regressions vs last pass.",
    "",
    ...mrrTable,
    "## Per case",
    "",
    header,
    sep,
    ...rows,
    ...means,
    "",
    "Only the hybrid arm is gated; `fts` (full-text only) and `vector` (vector only) are diagnostic.",
    "Skipped (—) = no expected sources for that case.",
    "",
  ].join("\n");
  await writeFile(path.join(RESULTS_DIR, "summary.md"), md);

  if (opts.updateLastPass && gate.passed && regressions.length === 0) {
    const scores = Object.fromEntries(
      results
        .filter((r) => r.arm === "hybrid" && r.recall_at_5 !== null)
        .map((r) => [`${r.case_id}|${r.mode}`, r.recall_at_5 as number]),
    );
    const previous = await readLastPass();
    await writeFile(
      LAST_PASS,
      JSON.stringify(
        {
          updated: meta.timestamp,
          milestone: meta.milestone,
          dataset_hash: meta.dataset_hash,
          embedding_model: meta.embedding_model,
          scores: { ...previous, ...scores },
        },
        null,
        2,
      ) + "\n",
    );
  }
  return { files, summary: path.join(RESULTS_DIR, "summary.md") };
}
