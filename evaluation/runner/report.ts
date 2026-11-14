import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { summarizeLatencyAndCost } from "./tier1b";
import type { CaseResult, Milestone, Mode } from "./types";

export const RESULTS_DIR = "evaluation/results";
export const LAST_PASS = path.join(RESULTS_DIR, "last-pass.json");

export type GateMetric =
  | "recall_at_5"
  | "confirmation_compliance"
  | "route_accuracy"
  | "tool_correctness"
  | "safe_behaviour"
  | "groundedness"
  | "citation_accuracy"
  | "completeness";

interface GateDef {
  metric: GateMetric;
  threshold: number;
  sc: string;
  reportOnly?: boolean;
}

/** Base Tier-1a gates by milestone (spec §6, T054 SC-006). */
const GATES: Record<Milestone, GateDef[]> = {
  M2: [{ metric: "recall_at_5", threshold: 0.9, sc: "SC-010" }],
  M3: [{ metric: "recall_at_5", threshold: 0.9, sc: "SC-010" }],
  M4: [
    { metric: "recall_at_5", threshold: 0.9, sc: "SC-010" },
    { metric: "confirmation_compliance", threshold: 1.0, sc: "SC-006" },
  ],
  M5: [
    { metric: "recall_at_5", threshold: 0.9, sc: "SC-010" },
    { metric: "confirmation_compliance", threshold: 1.0, sc: "SC-006" },
  ],
};

const OPTIONAL_TIER_GATES: GateDef[] = [
  { metric: "route_accuracy", threshold: 0.85, sc: "SC-004" },
  { metric: "tool_correctness", threshold: 0.9, sc: "SC-005" },
  { metric: "safe_behaviour", threshold: 1.0, sc: "SC-007" },
  { metric: "groundedness", threshold: 0.9, sc: "SC-001" },
  { metric: "citation_accuracy", threshold: 0.9, sc: "SC-002" },
  { metric: "completeness", threshold: 0.85, sc: "SC-003", reportOnly: true },
];

type Scored = Pick<
  CaseResult,
  | "case_id"
  | "mode"
  | "arm"
  | "recall_at_5"
  | "confirmation_compliance"
  | "route_accuracy"
  | "tool_correctness"
  | "safe_behaviour"
  | "groundedness"
  | "citation_accuracy"
  | "completeness"
>;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/**
 * Only graphrag (the copilot as shipped) is gated. Baseline is the comparison arm:
 * its gaps on multi-hop cases are the result we report (Constitution VIII), not a failure.
 */
export const GATED_MODES: Mode[] = ["graphrag"];

/** Mean metric per mode; only the hybrid arm is gated. Skipped (null) cases are excluded. */
export function evaluateGates(milestone: Milestone, results: Scored[]) {
  const modes = [...new Set(results.map((r) => r.mode))];
  const hasMetric = (m: GateMetric) =>
    results.some((r) => r[m] !== undefined && r[m] !== null);

  const gateDefs: GateDef[] = [...GATES[milestone]];
  if (
    hasMetric("confirmation_compliance") &&
    !gateDefs.some((g) => g.metric === "confirmation_compliance")
  ) {
    gateDefs.push({ metric: "confirmation_compliance", threshold: 1.0, sc: "SC-006" });
  }

  for (const opt of OPTIONAL_TIER_GATES) {
    if (hasMetric(opt.metric) && !gateDefs.some((g) => g.metric === opt.metric)) {
      gateDefs.push(opt);
    }
  }

  const gates = gateDefs.flatMap((g) => {
    return modes.map((mode) => {
      const vals = results
        .filter(
          (r) =>
            r.mode === mode &&
            r.arm === "hybrid" &&
            r[g.metric] !== null &&
            r[g.metric] !== undefined,
        )
        .map((r) => r[g.metric] as number);
      const value = mean(vals);
      // If a subset filter (e.g. --cases GS-028..GS-030) has 0 cases for recall_at_5 while other metrics are present,
      // do not fail on a 0-case metric.
      const hasOtherMetrics = gateDefs.length > 1;
      const isGated =
        !g.reportOnly &&
        GATED_MODES.includes(mode) &&
        (vals.length > 0 || !hasOtherMetrics);
      return {
        ...g,
        mode,
        value,
        cases: vals.length,
        gated: isGated,
        passed: vals.length > 0 && value >= g.threshold,
      };
    });
  });
  return { passed: gates.filter((g) => g.gated).every((g) => g.passed), gates };
}

/** "Don't start the next task while a previously passing case is failing" (CLAUDE.md). */
export function findRegressions(last: Record<string, number>, results: Scored[]) {
  return results
    .filter((r) => r.arm === "hybrid" && r.recall_at_5 !== null && GATED_MODES.includes(r.mode))
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

export interface VariationRow {
  metric: string;
  mode: Mode;
  runs: number;
  min: number;
  max: number;
  mean: number;
}

/**
 * 3-run variation report (T062, FR-021):
 * Computes min / max / mean across runs (`r.run = 1..N`) for each Tier-1b metric per mode.
 */
export function computeRunVariation(results: CaseResult[]): VariationRow[] {
  const runNums = [...new Set(results.map((r) => r.run ?? 1))].sort((a, b) => a - b);
  const modes = [...new Set(results.map((r) => r.mode))];
  const metricKeys: (keyof CaseResult)[] = [
    "recall_at_5",
    "route_accuracy",
    "tool_correctness",
    "safe_behaviour",
    "clarify_behaviour",
    "groundedness",
    "citation_accuracy",
    "completeness",
  ];

  const rows: VariationRow[] = [];
  for (const metric of metricKeys) {
    for (const mode of modes) {
      const perRunMeans: number[] = [];
      for (const run of runNums) {
        const vals = results
          .filter(
            (r) =>
              (r.run ?? 1) === run &&
              r.mode === mode &&
              r.arm === "hybrid" &&
              typeof r[metric] === "number" &&
              !Number.isNaN(r[metric] as number),
          )
          .map((r) => r[metric] as number);
        if (vals.length > 0) {
          perRunMeans.push(mean(vals));
        }
      }
      if (perRunMeans.length > 0) {
        rows.push({
          metric: String(metric),
          mode,
          runs: perRunMeans.length,
          min: Math.min(...perRunMeans),
          max: Math.max(...perRunMeans),
          mean: mean(perRunMeans),
        });
      }
    }
  }
  return rows;
}

export interface CategoryModeRow {
  category: string;
  mode: Mode;
  cases: number;
  recall_at_5: number | null;
  route_accuracy: number | null;
  tool_correctness: number | null;
  safe_behaviour: number | null;
  clarify_behaviour: number | null;
  groundedness: number | null;
  citation_accuracy: number | null;
  completeness: number | null;
}

/**
 * Metric × Mode × Category breakdown table (T062, US6, SC-003).
 */
export function buildCategoryModeTable(results: CaseResult[]): CategoryModeRow[] {
  const hybrid = results.filter((r) => r.arm === "hybrid" && (r.run ?? 1) === 1);
  const categories = [...new Set(hybrid.map((r) => r.category ?? "uncategorized"))];
  const modes = [...new Set(hybrid.map((r) => r.mode))];

  const avg = (subset: CaseResult[], key: keyof CaseResult): number | null => {
    const vals = subset
      .filter((r) => typeof r[key] === "number" && !Number.isNaN(r[key] as number))
      .map((r) => r[key] as number);
    return vals.length > 0 ? mean(vals) : null;
  };

  const out: CategoryModeRow[] = [];
  for (const category of categories) {
    for (const mode of modes) {
      const sub = hybrid.filter((r) => (r.category ?? "uncategorized") === category && r.mode === mode);
      if (sub.length === 0) continue;
      out.push({
        category,
        mode,
        cases: sub.length,
        recall_at_5: avg(sub, "recall_at_5"),
        route_accuracy: avg(sub, "route_accuracy"),
        tool_correctness: avg(sub, "tool_correctness"),
        safe_behaviour: avg(sub, "safe_behaviour"),
        clarify_behaviour: avg(sub, "clarify_behaviour"),
        groundedness: avg(sub, "groundedness"),
        citation_accuracy: avg(sub, "citation_accuracy"),
        completeness: avg(sub, "completeness"),
      });
    }
  }
  return out;
}

export interface RunMeta {
  timestamp: string;
  tier: string;
  milestone: Milestone;
  modes: Mode[];
  arms: string[];
  runs?: number;
  cases: string[];
  dataset_hash: string;
  embedding_model: string;
  provider?: string;
  models: Record<string, string>;
  graph: string;
  duration_ms: number;
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`;

/** Write `<ts>-<tier>-<mode>.jsonl` per mode, `summary.md`, and update last-pass.json on a pass. */
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
  const run1Results = results.filter((r) => (r.run ?? 1) === 1);
  const hasTier1b = results.some((r) => r.route_accuracy !== undefined);
  const hasTier2 = results.some((r) => r.groundedness !== undefined);

  const header = hasTier1b
    ? `| Case | Cat | Mode | recall@5 | route | tool | safe | clarify | ${
        hasTier2 ? "grounded | citation | complete | " : ""
      }latency (ms) | cost ($) |`
    : `| Case | Mode | ${arms.map((a) => `recall@5 ${a}`).join(" | ")} | ` +
      `${arms.map((a) => `coverage ${a}`).join(" | ")} | ` +
      `${arms.map((a) => `RR ${a}`).join(" | ")} | Expected | Top-5 docs (hybrid) |`;

  const sep = hasTier1b
    ? `|${"---|".repeat(hasTier2 ? 13 : 10)}`
    : `|${"---|".repeat(3 * arms.length + 4)}`;

  const rows = meta.cases.flatMap((id) =>
    meta.modes.map((mode) => {
      const by = (arm: string) =>
        run1Results.find((r) => r.case_id === id && r.mode === mode && r.arm === arm);
      const h = by("hybrid") ?? by(arms[0]);
      if (hasTier1b) {
        return (
          `| ${id} | ${h?.category ?? "—"} | ${mode} | ${pct(h?.recall_at_5)} | ${pct(h?.route_accuracy)} | ` +
          `${pct(h?.tool_correctness)} | ${pct(h?.safe_behaviour)} | ${pct(h?.clarify_behaviour)} | ` +
          (hasTier2
            ? `${pct(h?.groundedness)} | ${pct(h?.citation_accuracy)} | ${pct(h?.completeness)} | `
            : "") +
          `${h?.latency_ms ?? "—"} | ${h?.cost_usd !== undefined ? h.cost_usd.toFixed(4) : "—"} |`
        );
      }
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
  const means = hasTier1b
    ? []
    : meta.modes.map(
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

  // Category × Mode breakdown table (T062, US6).
  const categoryRows = buildCategoryModeTable(results);
  const categorySection =
    categoryRows.length > 0 && hasTier1b
      ? [
          "## Metric × Mode × Category (US6, T062)",
          "",
          `| Category | Mode | Cases | recall@5 | Route Acc | Tool Corr | Safe | Clarify |${
            hasTier2 ? " Groundedness | Citation Acc | Completeness |" : ""
          }`,
          `|---|---|---|---|---|---|---|---|${hasTier2 ? "---|---|---|" : ""}`,
          ...categoryRows.map(
            (r) =>
              `| ${r.category} | ${r.mode} | ${r.cases} | ${pct(r.recall_at_5)} | ${pct(r.route_accuracy)} | ${pct(r.tool_correctness)} | ${pct(r.safe_behaviour)} | ${pct(r.clarify_behaviour)} |${
                hasTier2
                  ? ` ${pct(r.groundedness)} | ${pct(r.citation_accuracy)} | ${pct(r.completeness)} |`
                  : ""
              }`,
          ),
          "",
        ]
      : [];

  // Latency and Cost summary (SC-008, SC-009).
  const perfSection = hasTier1b
    ? [
        "## Latency & Cost (SC-008, SC-009)",
        "",
        "| Mode | Turns | p50 Latency (ms) | p95 Latency (ms) | Mean Latency (ms) | Mean Cost ($) | Total Cost ($) |",
        "|---|---|---|---|---|---|---|",
        ...meta.modes.map((mode) => {
          const s = summarizeLatencyAndCost(results, mode);
          return `| ${mode} | ${s.count} | ${s.p50_latency_ms} | ${s.p95_latency_ms} | ${s.mean_latency_ms} | $${s.mean_cost_usd.toFixed(4)} | $${s.total_cost_usd.toFixed(4)} |`;
        }),
        "",
      ]
    : [];

  // Multi-run variation report (T062, FR-021).
  const variationRows = computeRunVariation(results);
  const maxRuns = Math.max(1, ...variationRows.map((v) => v.runs));
  const variationSection =
    maxRuns > 1 || hasTier1b
      ? [
          `## Multi-Run Variation (${maxRuns} run${maxRuns > 1 ? "s" : ""}, T062)`,
          "",
          "| Metric | Mode | Runs | Min | Max | Mean | Spread (Max - Min) |",
          "|---|---|---|---|---|---|---|",
          ...variationRows.map(
            (v) =>
              `| ${v.metric} | ${v.mode} | ${v.runs} | ${pct(v.min)} | ${pct(v.max)} | ${pct(v.mean)} | ${((v.max - v.min) * 100).toFixed(1)} pts |`,
          ),
          "",
        ]
      : [];

  const md = [
    `# Eval summary: Tier ${meta.tier}, ${meta.milestone}`,
    "",
    `Run ${meta.timestamp} · ${meta.cases.length} cases · ${meta.runs ?? 1} run(s) · ${(meta.duration_ms / 1000).toFixed(1)} s · provider ${meta.provider ?? "anthropic"} · router ${meta.models.router} · agent ${meta.models.agent} · judge ${meta.models.judge} · embedding ${meta.embedding_model} · dataset ${meta.dataset_hash.slice(0, 12)}`,
    "",
    "## Gates",
    "",
    "| SC | Metric | Mode | Value | Threshold | Cases | Result |",
    "|---|---|---|---|---|---|---|",
    ...gate.gates.map(
      (g) =>
        `| ${g.sc} | ${g.metric} (hybrid) | ${g.mode} | ${pct(g.value)} | ${g.gated ? pct(g.threshold) : "—"} | ${g.cases} | ${g.gated ? (g.passed ? "✅ pass" : "❌ fail") : "reported (not gated)"} |`,
    ),
    "",
    regressions.length
      ? `**Regressions vs last pass:** ${regressions.map((r) => `${r.key} ${pct(r.previous)} → ${pct(r.current)}`).join("; ")}`
      : "No regressions vs last pass.",
    "",
    ...mrrTable,
    ...categorySection,
    ...perfSection,
    ...variationSection,
    "## Per case",
    "",
    header,
    sep,
    ...rows,
    ...means,
    "",
    "Only graphrag mode, hybrid arm, is gated. Baseline is reported for comparison. `fts` (full-text only) and `vector` (vector only) are diagnostic.",
    "Skipped (—) = metric not applicable to that case category.",
    "",
  ].join("\n");
  await writeFile(path.join(RESULTS_DIR, "summary.md"), md);

  if (opts.updateLastPass && gate.passed && regressions.length === 0) {
    const scores = Object.fromEntries(
      results
        .filter((r) => r.arm === "hybrid" && r.recall_at_5 !== null && GATED_MODES.includes(r.mode))
        .map((r) => [`${r.case_id}|${r.mode}`, r.recall_at_5 as number]),
    );
    const previous = await readLastPass();
    await writeFile(
      LAST_PASS,
      JSON.stringify(
        {
          updated: meta.timestamp,
          milestone: meta.milestone,
          tier: meta.tier,
          label: `${meta.milestone} (Tier ${meta.tier}) regression baseline: ${meta.cases.join(", ")}`,
          dataset_hash: meta.dataset_hash,
          embedding_model: meta.embedding_model,
          gated_modes: GATED_MODES,
          scores: { ...previous, ...scores },
        },
        null,
        2,
      ) + "\n",
    );
  }
  return { files, summary: path.join(RESULTS_DIR, "summary.md") };
}
