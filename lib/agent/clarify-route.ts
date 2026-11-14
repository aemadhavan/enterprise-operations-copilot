import { readFileSync } from "node:fs";
import path from "node:path";
import type { ModelClient } from "@/lib/model";
import { computeConfidence, renderMarkdown, type RetrievedSet } from "./answer";
import { FinalAnswer, jsonSchemaFor, type Confidence } from "./schemas";

export type ClarifyKind = "warehouse_access" | "action_request" | "approval_lookup";

let clarifyPrompt: string | undefined;
export const loadClarifyPrompt = () =>
  (clarifyPrompt ??= readFileSync(path.join(process.cwd(), "lib/agent/prompts/clarify.md"), "utf8"));

export interface ClarifyRouteResult {
  kind: ClarifyKind;
  answer: FinalAnswer;
  confidence: Confidence;
  markdown: string;
  retrieved: RetrievedSet;
  dropped_citations: number;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface ClarifyRouteDeps {
  model?: Pick<ModelClient, "create" | "model">;
  missingFields?: string[];
}

const WAREHOUSE_RE = /\bwarehouse\b/i;
const ACTION_INTENT_RE =
  /\b(i\s+need\s+access|grant\s+me|give\s+me\s+access|request\s+access|raise\s+an?\s+access|open\s+a\s+request|provision|need\s+(read|write|admin)\s+access)\b/i;

export function classifyClarifyKind(question: string): ClarifyKind {
  if (WAREHOUSE_RE.test(question)) {
    return "warehouse_access";
  }
  if (ACTION_INTENT_RE.test(question)) {
    return "action_request";
  }
  return "approval_lookup";
}

/**
 * Normalise any model-returned clarifying question so it is strictly a single question
 * (exactly one `?` at the end) and covers the required dimensions for the clarify kind.
 */
export function normalizeSingleQuestion(raw: string | null | undefined, kind: ClarifyKind): string {
  const fallback = buildDeterministicClarifyQuestion(kind);
  if (!raw || !raw.trim()) return fallback;

  // Replace any intermediate question marks with "; " and ensure a single trailing "?"
  const cleaned = raw
    .trim()
    .replace(/\?+/g, "?")
    .split("?")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("; ");
  const single = cleaned.endsWith("?") ? cleaned : `${cleaned}?`;

  // Verify required coverage for the specific clarify kind; fall back if incomplete.
  if (kind === "warehouse_access") {
    const hasLumen = /Lumen Data Warehouse/i.test(single);
    const hasLevel = /access level|read,\s*write,\s*or\s*admin/i.test(single);
    const hasDuration = /duration|how long|days/i.test(single);
    const hasRequester = /requester type|employee or contractor/i.test(single);
    const hasJustification = /justification/i.test(single);
    if (!hasLumen || !hasLevel || !hasDuration || !hasRequester || !hasJustification) {
      return fallback;
    }
  } else if (kind === "action_request") {
    const hasSystem = /system|data/i.test(single);
    const hasRequester = /requester type|employee or contractor/i.test(single);
    const hasLevel = /access level|read,\s*write,\s*or\s*admin/i.test(single);
    const hasDuration = /duration|how long|days/i.test(single);
    const hasJustification = /justification/i.test(single);
    if (!hasSystem || !hasRequester || !hasLevel || !hasDuration || !hasJustification) {
      return fallback;
    }
  } else {
    const hasSystemOrData = /system|data/i.test(single);
    const hasRequester = /requester type|employee or contractor/i.test(single);
    const hasLevel = /access level|read,\s*write,\s*or\s*admin/i.test(single);
    if (!hasSystemOrData || !hasRequester || !hasLevel) {
      return fallback;
    }
  }

  return single;
}

export function buildDeterministicClarifyQuestion(kind: ClarifyKind): string {
  if (kind === "warehouse_access") {
    return "Could you confirm whether you mean Lumen Data Warehouse (SYS-DWH), and let me know your requester type (employee or contractor), required access level (read, write, or admin), requested duration in days, and business justification (plus your sponsor if you are a contractor)?";
  }
  if (kind === "action_request") {
    return "Which target system or data class do you need access to, and what are your requester type (employee or contractor), required access level (read, write, or admin), requested duration in days, and business justification (plus your sponsor if you are a contractor)?";
  }
  return "Which target system or data classification are you asking about, is the requester an employee or a contractor, and what access level (read, write, or admin) is required?";
}

export function buildDeterministicClarify(kind: ClarifyKind): FinalAnswer {
  return {
    behaviour: "clarify",
    claims: [],
    assumptions: [],
    gaps: [],
    clarifying_question: buildDeterministicClarifyQuestion(kind),
    legitimate_path: null,
  };
}

/**
 * `clarify` route (T052, FR-013, US5):
 * - Offers NO tools (never passes `tools` to the model, never executes any MCP tool).
 * - Always returns `behaviour: "clarify"`, `claims: []`, and a single focused `clarifying_question`
 *   covering target system/data, requester type (employee or contractor), and access level
 *   (plus duration and justification for underspecified access requests, and confirming
 *   Lumen Data Warehouse when "warehouse" is mentioned).
 */
export async function answerClarifyRoute(
  question: string,
  deps: ClarifyRouteDeps = {},
): Promise<ClarifyRouteResult> {
  const kind = classifyClarifyKind(question);
  const retrieved: RetrievedSet = { chunks: [], edges: [] };
  const fallback = buildDeterministicClarify(kind);

  if (!deps.model) {
    return {
      kind,
      answer: fallback,
      confidence: computeConfidence(fallback, retrieved),
      markdown: renderMarkdown(fallback),
      retrieved,
      dropped_citations: 0,
    };
  }

  const missingHint =
    deps.missingFields && deps.missingFields.length > 0
      ? `\n<missing_fields>${deps.missingFields.join(", ")}</missing_fields>`
      : "";

  const res = await deps.model.create({
    max_tokens: 1000,
    system: loadClarifyPrompt(),
    messages: [
      {
        role: "user",
        content: `<question>${question}</question>${missingHint}`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: jsonSchemaFor(FinalAnswer) } },
  } as never);

  const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };

  if (res.stop_reason === "refusal") {
    return {
      kind,
      answer: fallback,
      confidence: computeConfidence(fallback, retrieved),
      markdown: renderMarkdown(fallback),
      retrieved,
      dropped_citations: 0,
      usage,
    };
  }

  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = FinalAnswer.parse(JSON.parse(text));
  const dropped_citations = parsed.claims.reduce((n, c) => n + c.citations.length, 0);

  const normalized: FinalAnswer = {
    behaviour: "clarify",
    claims: [],
    assumptions: [],
    gaps: [],
    clarifying_question: normalizeSingleQuestion(parsed.clarifying_question, kind),
    legitimate_path: null,
  };

  return {
    kind,
    answer: normalized,
    confidence: computeConfidence(normalized, retrieved),
    markdown: renderMarkdown(normalized),
    retrieved,
    dropped_citations,
    usage,
  };
}
