// Route accuracy check (SC-004 style; Tier 1b is v0.2, so this is reported, not gated).
//   pnpm eval:route --dry    pre-rules only, no model calls (only unsafe cases can be routed)
//   pnpm eval:route          live router (claude-haiku-5-5, effort low) on all 30 cases
import "../../scripts/_env";
import { closePool, sql } from "@/lib/db/client";
import type { GraphNode } from "@/lib/graph/load";
import { routeQuestion, UNSAFE_PATTERNS } from "@/lib/router";
import { loadGoldenSet } from "./cli";

const dry = process.argv.includes("--dry");
const { cases } = loadGoldenSet();
const nodes = (await sql`SELECT id, label, name, classification, description, source_doc
  FROM nodes`) as GraphNode[];

let correct = 0;
let input = 0;
let output = 0;
const started = performance.now();
const misses: string[] = [];
for (const c of cases) {
  let route: string;
  let how: string;
  if (dry) {
    const hit = UNSAFE_PATTERNS.find((p) => p.pattern.test(c.question));
    route = hit ? "refuse" : "(needs model)";
    how = hit ? `pre-rule ${hit.rule}` : "-";
  } else {
    const d = await routeQuestion(c.question, { nodes });
    route = d.route;
    how = d.pre_rule ? `pre-rule ${d.pre_rule}` : `model intent=${d.intent} risk=${d.risk}`;
    input += d.usage?.input_tokens ?? 0;
    output += d.usage?.output_tokens ?? 0;
  }
  const ok = route === c.expected_route;
  if (ok) correct++;
  else misses.push(`${c.id} expected ${c.expected_route}, got ${route}`);
  console.log(
    `${ok ? "✓" : "✗"} ${c.id} ${c.category.padEnd(14)} expected=${c.expected_route.padEnd(15)} got=${route.padEnd(15)} ${how}`,
  );
}
const secs = ((performance.now() - started) / 1000).toFixed(1);
console.log(
  `\nRoute accuracy (${dry ? "dry: pre-rules only" : "live router"}): ${correct}/${cases.length} = ${((100 * correct) / cases.length).toFixed(1)}% in ${secs} s` +
    (dry ? "" : ` · tokens in=${input} out=${output}`),
);
if (misses.length) console.log(`Misses:\n  ${misses.join("\n  ")}`);
await closePool();
