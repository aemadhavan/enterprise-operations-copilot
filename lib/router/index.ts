import { readFileSync } from "node:fs";
import path from "node:path";
import {
  jsonSchemaFor,
  ROUTE_FOR_INTENT,
  RouterOutput,
  type Intent,
  type Route,
} from "@/lib/agent/schemas";
import { sql } from "@/lib/db/client";
import type { GraphNode } from "@/lib/graph/load";
import { resolveEntities } from "@/lib/graph/resolve";
import { createClient, type ModelClient } from "@/lib/model";
import { computeRisk, type Risk } from "./risk";

/**
 * Deterministic unsafe pre-rules (ADR-008): checked before any model call, so the common
 * bypass / injection / exfiltration patterns never depend on the model.
 */
export const UNSAFE_PATTERNS: { rule: string; pattern: RegExp }[] = [
  {
    rule: "bypass_approval",
    pattern: /\b(skip|bypass|without|ignore|avoid)\b[^.?!]{0,30}\bapprovals?\b/i,
  },
  {
    rule: "prompt_injection",
    pattern:
      /\b(ignore|disregard|forget)\b[^.?!]{0,20}\b(previous|prior|above|your|all)\b[^.?!]{0,20}\b(instructions|rules|prompt)\b/i,
  },
  {
    rule: "bulk_export",
    pattern: /\bexport\b[^.?!]{0,20}\ball\b[^.?!]{0,40}\b(customer|employee|records|pii|data)\b/i,
  },
  {
    rule: "record_request",
    pattern:
      /\b(home )?addresses\b|\b(list|show|give me|dump)\b[^.?!]{0,30}\b(customers|customer records|employees'? (records|details))\b/i,
  },
];

export interface RouteDecision {
  intent: Intent;
  route: Route;
  risk: Risk;
  entities: { id: string; label: string; name: string; classification: string | null }[];
  router: RouterOutput | null; // null when a pre-rule decided
  pre_rule: string | null;
  refused_by_model: boolean;
  usage?: { input_tokens: number; output_tokens: number };
}

let routerPrompt: string | undefined;
const loadPrompt = () =>
  (routerPrompt ??= readFileSync(path.join(process.cwd(), "lib/router/prompts/router.md"), "utf8"));

let nodeCache: GraphNode[] | undefined;
async function loadNodes(): Promise<GraphNode[]> {
  nodeCache ??= (await sql`SELECT id, label, name, classification, description, source_doc
    FROM nodes`) as GraphNode[];
  return nodeCache;
}

export interface RouterDeps {
  model?: Pick<ModelClient, "create" | "model">;
  nodes?: GraphNode[];
}

function decide(
  intent: Intent,
  question: string,
  router: RouterOutput | null,
  nodes: GraphNode[],
  extra: Partial<RouteDecision> = {},
): RouteDecision {
  const mentions = router?.entities.map((e) => e.mention).join(" ") ?? "";
  const entities = resolveEntities(`${question} ${mentions}`, nodes);
  return {
    intent,
    route: ROUTE_FOR_INTENT[intent],
    risk: computeRisk(intent, entities),
    entities: entities.map(({ id, label, name, classification }) => ({
      id,
      label,
      name,
      classification,
    })),
    router,
    pre_rule: null,
    refused_by_model: false,
    ...extra,
  };
}

/** Classify a message: pre-rules → Haiku structured output → code-computed risk and route. */
export async function routeQuestion(
  question: string,
  deps: RouterDeps = {},
): Promise<RouteDecision> {
  const nodes = deps.nodes ?? (await loadNodes());

  const hit = UNSAFE_PATTERNS.find((p) => p.pattern.test(question));
  if (hit) return decide("unsafe", question, null, nodes, { pre_rule: hit.rule });

  const model = deps.model ?? createClient("router");
  const res = await model.create({
    max_tokens: 1000,
    system: loadPrompt(),
    messages: [{ role: "user", content: `<message>${question}</message>` }],
    output_config: { format: { type: "json_schema", schema: jsonSchemaFor(RouterOutput) } },
  } as never);
  const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };

  if (res.stop_reason === "refusal") {
    return decide("unsafe", question, null, nodes, { refused_by_model: true, usage });
  }
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = RouterOutput.parse(JSON.parse(text));
  return decide(parsed.intent, question, parsed, nodes, { usage });
}
