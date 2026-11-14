// Eval runner CLI (FR-018, FR-020, FR-021, FR-022):
//   pnpm eval:fast  (--tier 1a, no model calls)
//   pnpm eval:model (--tier 1b, copilot turns: route, tool, safety, clarify, latency, cost)
//   pnpm eval:full  (--tier 2,  Tier 1a + 1b + Opus judge: groundedness, citation, completeness)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { SearchArms } from "@/lib/retrieval/hybrid";
import type { GoldenCase, Milestone, Mode, Tier } from "./types";

export const GOLDEN_SET = "evaluation/golden_set.jsonl";

/** Default case sets per milestone (evaluation/README.md). */
export const MILESTONE_CASES: Record<Milestone, string> = {
  M2: "GS-001..GS-008,GS-018..GS-020",
  M3: "GS-001..GS-016,GS-018..GS-021",
  M4: "GS-001..GS-030",
  M5: "GS-001..GS-030",
};

export interface Args {
  tier: Tier;
  milestone: Milestone;
  cases: string[] | null;
  category: string | null;
  mode: Mode | "both";
  arms: SearchArms[];
  runs: number;
  updateLastPass: boolean;
}

export function expandCaseRanges(spec: string): string[] {
  return spec.split(",").flatMap((part) => {
    const [a, b] = part.trim().split("..");
    if (!b) return [a];
    const n = (id: string) => Number(id.replace(/^GS-/, ""));
    const out: string[] = [];
    for (let i = n(a); i <= n(b); i++) out.push(`GS-${String(i).padStart(3, "0")}`);
    return out;
  });
}

function oneOf<T extends string>(flag: string, value: string | undefined, allowed: T[]): T {
  if (!value || !allowed.includes(value as T)) {
    throw new Error(`--${flag} must be one of ${allowed.join(", ")} (got ${value ?? "nothing"})`);
  }
  return value as T;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    tier: "1a",
    milestone: "M2",
    cases: null,
    category: null,
    mode: "both",
    arms: ["hybrid"],
    runs: 1,
    updateLastPass: true,
  };
  let explicitMilestone = false;
  let explicitMode = false;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => argv[++i];
    switch (flag) {
      case "--tier":
        a.tier = oneOf("tier", next(), ["1a", "1b", "2"]);
        break;
      case "--milestone":
        a.milestone = oneOf("milestone", next(), ["M2", "M3", "M4", "M5"]);
        explicitMilestone = true;
        break;
      case "--cases":
        a.cases = expandCaseRanges(next() ?? "");
        break;
      case "--category":
        a.category = next() ?? null;
        break;
      case "--mode":
        a.mode = oneOf("mode", next(), ["baseline", "graphrag", "both"]);
        explicitMode = true;
        break;
      case "--arms": {
        const v = oneOf("arms", next(), ["hybrid", "fts", "vector", "all"]);
        a.arms = v === "all" ? ["hybrid", "fts", "vector"] : [v];
        break;
      }
      case "--runs":
        a.runs = Math.max(1, Number(next()) || 1);
        break;
      case "--no-update":
        a.updateLastPass = false;
        break;
      default:
        throw new Error(`Unknown flag ${flag}`);
    }
  }

  // Tier 1b defaults to M4 (all 30 cases) and graphrag unless overridden; Tier 2 defaults to M5 and both modes.
  if (!explicitMilestone) {
    if (a.tier === "1b") a.milestone = "M4";
    if (a.tier === "2") a.milestone = "M5";
  }
  if (!explicitMode && a.tier === "1b") {
    a.mode = "graphrag";
  }

  return a;
}

export function loadGoldenSet(file = GOLDEN_SET): { cases: GoldenCase[]; hash: string } {
  const raw = readFileSync(file, "utf8");
  const cases = raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as GoldenCase);
  return { cases, hash: createHash("sha256").update(raw).digest("hex") };
}

export function selectCases(all: GoldenCase[], args: Args): GoldenCase[] {
  if (args.cases) return all.filter((c) => args.cases!.includes(c.id));
  if (args.category) return all.filter((c) => c.category === args.category);
  const ids = expandCaseRanges(MILESTONE_CASES[args.milestone]);
  return all.filter((c) => ids.includes(c.id));
}

async function main() {
  await import("../../scripts/_env");
  const { getConfig } = await import("@/lib/config");
  const { closePool } = await import("@/lib/db/client");
  const { runRetrieval, runValidator } = await import("./tier1a");
  const { runTier1b } = await import("./tier1b");
  const { runTier2 } = await import("./tier2");
  const report = await import("./report");

  const args = parseArgs(process.argv.slice(2));
  const config = getConfig();
  const started = performance.now();

  const v = runValidator();
  console.log(`Validator: ${v.ok ? "pass" : "FAIL"}`);
  if (!v.ok) {
    console.error(v.output);
    process.exitCode = 1;
    return;
  }

  const { cases: all, hash } = loadGoldenSet();
  const cases = selectCases(all, args);
  const modes: Mode[] = args.mode === "both" ? ["baseline", "graphrag"] : [args.mode];

  try {
    let results = [];
    if (args.tier === "1a") {
      for (let run = 1; run <= args.runs; run++) {
        const batch = await runRetrieval(cases, modes, args.arms);
        results.push(...batch.map((r) => ({ ...r, category: all.find((c) => c.id === r.case_id)?.category, run })));
      }
    } else if (args.tier === "1b") {
      const out = await runTier1b(cases, modes, {
        runs: args.runs,
        onCaseComplete: (r) => {
          console.log(
            `[1b run=${r.run}] ${r.case_id} (${r.mode}) route=${r.route_chosen}/${r.expected_route} ${r.route_accuracy === 1 ? "✓" : "✗"}` +
              (r.tool_correctness !== null && r.tool_correctness !== undefined
                ? ` tool=${r.tool_correctness}`
                : "") +
              (r.safe_behaviour !== null && r.safe_behaviour !== undefined
                ? ` safe=${r.safe_behaviour}`
                : "") +
              (r.clarify_behaviour !== null && r.clarify_behaviour !== undefined
                ? ` clarify=${r.clarify_behaviour}`
                : "") +
              ` (${r.latency_ms} ms, $${(r.cost_usd ?? 0).toFixed(4)})`,
          );
        },
      });
      results = out.results;
    } else {
      results = await runTier2(cases, modes, {
        runs: args.runs,
        onCaseComplete: (r) => {
          console.log(
            `[2 turn run=${r.run}] ${r.case_id} (${r.mode}) route=${r.route_chosen}/${r.expected_route} (${r.latency_ms} ms)`,
          );
        },
      });
    }

    const duration_ms = Math.round(performance.now() - started);
    const gate = report.evaluateGates(args.milestone, results);
    const regressions = report.findRegressions(await report.readLastPass(), results);
    const out = await report.writeReport(
      {
        timestamp: new Date().toISOString(),
        tier: args.tier,
        milestone: args.milestone,
        modes,
        arms: args.arms,
        runs: args.runs,
        cases: cases.map((c) => c.id),
        dataset_hash: hash,
        embedding_model: config.EMBEDDING_MODEL,
        provider: config.MODEL_PROVIDER,
        models: {
          router:
            config.MODEL_PROVIDER === "bedrock"
              ? config.BEDROCK_ROUTER_MODEL_ID
              : config.ROUTER_MODEL,
          agent:
            config.MODEL_PROVIDER === "bedrock"
              ? config.BEDROCK_MODEL_ID
              : config.ANTHROPIC_MODEL,
          judge: config.JUDGE_MODEL,
          note:
            args.tier === "1a"
              ? "Tier 1a makes no chat-model calls"
              : args.tier === "1b"
                ? "Tier 1b runs copilot turns with fixed effort (no judge calls)"
                : "Tier 2 runs copilot turns + JUDGE_MODEL (Opus) scoring",
        },
        graph:
          "graphrag = hybrid text + graph_query node mode from resolved entities (graph-route cases)",
        duration_ms,
      },
      results,
      gate,
      regressions,
      { updateLastPass: args.updateLastPass },
    );

    for (const g of gate.gates) {
      console.log(
        g.gated
          ? `${g.sc} ${g.metric} [${g.mode}] ${(g.value * 100).toFixed(1)}% (threshold ${g.threshold * 100}%, ${g.cases} cases) ${g.passed ? "PASS" : "FAIL"}`
          : `${g.sc} ${g.metric} [${g.mode}] ${(g.value * 100).toFixed(1)}% (${g.cases} cases) reported, not gated`,
      );
    }
    for (const r of regressions) console.log(`REGRESSION ${r.key}: ${r.previous} → ${r.current}`);
    console.log(`${cases.length} cases in ${(duration_ms / 1000).toFixed(1)} s → ${out.summary}`);
    process.exitCode = gate.passed && regressions.length === 0 ? 0 : 1;
  } finally {
    await closePool();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
