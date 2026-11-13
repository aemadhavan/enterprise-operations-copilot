// Eval runner CLI (FR-018, FR-022). Tier 1a = no model calls.
//   pnpm eval:fast [--milestone M2] [--cases GS-001..GS-008,GS-018] [--category direct]
//                  [--mode baseline|graphrag|both] [--arms hybrid|fts|vector|all] [--runs N]
//                  [--no-update]   (do not write last-pass.json)
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
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => argv[++i];
    switch (flag) {
      case "--tier":
        a.tier = oneOf("tier", next(), ["1a", "1b", "2"]);
        break;
      case "--milestone":
        a.milestone = oneOf("milestone", next(), ["M2", "M3", "M4", "M5"]);
        break;
      case "--cases":
        a.cases = expandCaseRanges(next() ?? "");
        break;
      case "--category":
        a.category = next() ?? null;
        break;
      case "--mode":
        a.mode = oneOf("mode", next(), ["baseline", "graphrag", "both"]);
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
  const report = await import("./report");

  const args = parseArgs(process.argv.slice(2));
  if (args.tier !== "1a") {
    console.error(`Tier ${args.tier} is v0.2 (PRD §10.1); only Tier 1a exists in v0.1.`);
    process.exitCode = 2;
    return;
  }
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
    const results = [];
    for (let run = 0; run < args.runs; run++) {
      results.push(...(await runRetrieval(cases, modes, args.arms)));
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
        cases: cases.map((c) => c.id),
        dataset_hash: hash,
        embedding_model: config.EMBEDDING_MODEL,
        models: {
          router: config.ROUTER_MODEL,
          agent: config.ANTHROPIC_MODEL,
          judge: config.JUDGE_MODEL,
          note: "Tier 1a makes no chat-model calls",
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
        `${g.sc} ${g.metric} [${g.mode}] ${(g.value * 100).toFixed(1)}% (threshold ${g.threshold * 100}%, ${g.cases} cases) ${g.passed ? "PASS" : "FAIL"}`,
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
