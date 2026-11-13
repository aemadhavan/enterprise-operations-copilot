import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type ModelClient } from "@/lib/model";
import { hybridSearch, type SearchResult } from "@/lib/retrieval/hybrid";
import { computeConfidence, filterCitations, renderMarkdown, type RetrievedSet } from "./answer";
import { FinalAnswer, jsonSchemaFor, type Confidence } from "./schemas";

/** Chunks sent to the model per turn. */
export const TEXT_ROUTE_K = 8;

let systemPrompt: string | undefined;
const loadPrompt = () =>
  (systemPrompt ??= readFileSync(path.join(process.cwd(), "lib/agent/prompts/answer.md"), "utf8"));

export interface TextRouteResult {
  answer: FinalAnswer;
  confidence: Confidence;
  markdown: string;
  retrieved: SearchResult[];
  dropped_citations: number;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface TextRouteDeps {
  search?: (q: string) => Promise<SearchResult[]>;
  model?: Pick<ModelClient, "create" | "model">;
}

const GAP_ANSWER: FinalAnswer = {
  behaviour: "state_gap",
  claims: [],
  assumptions: [],
  gaps: ["The knowledge base does not cover this question."],
  clarifying_question: null,
  legitimate_path: null,
};

/** Effective-dated, authoritative documents first; meeting notes last (FR-008). */
export function orderEvidence(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => Number(b.is_authoritative) - Number(a.is_authoritative));
}

export function formatEvidence(results: SearchResult[]): string {
  return results
    .map(
      (r, i) =>
        `<excerpt n="${i + 1}" doc_id="${r.doc_id}" section="${r.section}" effective_date="${r.effective_date ?? "none"}" status="${r.is_authoritative ? "effective_policy" : "proposal_or_meeting"}" title="${r.title}">\n${r.text}\n</excerpt>`,
    )
    .join("\n\n");
}

function finish(
  answer: FinalAnswer,
  retrievedSet: RetrievedSet,
  retrieved: SearchResult[],
  dropped: number,
  usage?: TextRouteResult["usage"],
): TextRouteResult {
  return {
    answer,
    confidence: computeConfidence(answer, retrievedSet),
    markdown: renderMarkdown(answer),
    retrieved,
    dropped_citations: dropped,
    usage,
  };
}

/**
 * `text` route (FR-004, FR-007, FR-008): hybrid search → Sonnet structured output →
 * citation filtering + confidence in code → sanitised Markdown. Returns `state_gap` when
 * nothing is retrieved or no claim keeps a retrieved citation.
 */
export async function answerTextRoute(
  question: string,
  deps: TextRouteDeps = {},
): Promise<TextRouteResult> {
  const search = deps.search ?? ((q: string) => hybridSearch(q, { k: TEXT_ROUTE_K }));
  const retrieved = orderEvidence((await search(question)).slice(0, TEXT_ROUTE_K));
  const retrievedSet: RetrievedSet = {
    chunks: retrieved.map((r) => ({
      doc_id: r.doc_id,
      section: r.section,
      is_authoritative: r.is_authoritative,
    })),
    edges: [],
  };
  if (retrieved.length === 0) return finish(GAP_ANSWER, retrievedSet, retrieved, 0);

  const model = deps.model ?? createClient("agent");
  const res = await model.create({
    max_tokens: 4000,
    system: loadPrompt(),
    messages: [
      {
        role: "user",
        content: `<evidence>\n${formatEvidence(retrieved)}\n</evidence>\n\n<question>${question}</question>`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: jsonSchemaFor(FinalAnswer) } },
  } as never);

  if (res.stop_reason === "refusal") {
    return finish(
      { ...GAP_ANSWER, gaps: ["The model declined to answer this question."] },
      retrievedSet,
      retrieved,
      0,
    );
  }
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = FinalAnswer.parse(JSON.parse(text));
  const { dropped, ...filtered } = filterCitations(parsed, retrievedSet);
  const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };

  const anyCited = filtered.claims.some((c) => c.citations.length > 0);
  if (filtered.behaviour === "answer" && !anyCited) {
    return finish(GAP_ANSWER, retrievedSet, retrieved, dropped, usage);
  }
  return finish(filtered, retrievedSet, retrieved, dropped, usage);
}
