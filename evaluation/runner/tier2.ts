import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { jsonSchemaFor, type Citation } from "@/lib/agent/schemas";
import type { TurnResult } from "@/lib/agent/turn";
import { sql } from "@/lib/db/client";
import { createClient, type ModelClient } from "@/lib/model";
import { runTier1b, turnKey, type Tier1bOptions } from "./tier1b";
import type { CaseResult, GoldenCase, Mode } from "./types";

let groundednessPrompt: string | undefined;
let citationPrompt: string | undefined;
let completenessPrompt: string | undefined;

export const loadGroundednessPrompt = () =>
  (groundednessPrompt ??= readFileSync(
    path.join(process.cwd(), "evaluation/judges/groundedness.v1.md"),
    "utf8",
  ));

export const loadCitationPrompt = () =>
  (citationPrompt ??= readFileSync(
    path.join(process.cwd(), "evaluation/judges/citation.v1.md"),
    "utf8",
  ));

export const loadCompletenessPrompt = () =>
  (completenessPrompt ??= readFileSync(
    path.join(process.cwd(), "evaluation/judges/completeness.v1.md"),
    "utf8",
  ));

export const GroundednessJudgeOutput = z.strictObject({
  claims: z.array(
    z.strictObject({
      claim: z.string(),
      supported: z.boolean(),
      reason: z.string(),
    }),
  ),
  rationale: z.string(),
});

export const CitationJudgeOutput = z.strictObject({
  pairs: z.array(
    z.strictObject({
      claim: z.string(),
      citation: z.string(),
      supported: z.boolean(),
      reason: z.string(),
    }),
  ),
  rationale: z.string(),
});

export const CompletenessJudgeOutput = z.strictObject({
  points: z.array(
    z.strictObject({
      point: z.string(),
      covered: z.boolean(),
      reason: z.string(),
    }),
  ),
  rationale: z.string(),
});

function formatCitationRef(cit: Citation): string {
  if ("edge" in cit) {
    return `${cit.edge.source} -${cit.edge.relation}-> ${cit.edge.target} (${cit.edge.source_doc})`;
  }
  return `${cit.doc_id} §${cit.section}`;
}

export function formatTurnEvidenceForJudge(turn: TurnResult): string {
  const parts: string[] = [];

  for (const ex of turn.evidence_excerpts ?? []) {
    parts.push(`<excerpt doc_id="${ex.doc_id}" section="${ex.section}">\n${ex.text}\n</excerpt>`);
  }

  if (turn.graph_path.nodes.length > 0) {
    const nodesText = turn.graph_path.nodes
      .map((n) => `${n.id} (${n.label}: ${n.name}, classification=${n.classification ?? "none"})`)
      .join("\n");
    parts.push(`<graph_nodes>\n${nodesText}\n</graph_nodes>`);
  }

  if (turn.graph_path.edges.length > 0) {
    const edgesText = turn.graph_path.edges
      .map(
        (e) =>
          `${e.source} -${e.relation}-> ${e.target} (condition=${e.condition ?? "none"}, source_doc=${e.source_doc ?? "none"})`,
      )
      .join("\n");
    parts.push(`<graph_edges>\n${edgesText}\n</graph_edges>`);
  }

  if (turn.draft) {
    parts.push(`<draft_record>\n${JSON.stringify(turn.draft, null, 2)}\n</draft_record>`);
  }

  return parts.join("\n\n") || "(no retrieved evidence)";
}

export function formatTurnAnswerForJudge(turn: TurnResult): string {
  const sections: string[] = [
    `behaviour: ${turn.answer.behaviour}`,
    `markdown:\n${turn.answer.markdown}`,
  ];
  if (turn.answer.clarifying_question) {
    sections.push(`clarifying_question: ${turn.answer.clarifying_question}`);
  }
  if (turn.answer.legitimate_path) {
    sections.push(`legitimate_path: ${turn.answer.legitimate_path}`);
  }
  if (turn.draft) {
    sections.push(
      `draft_summary: kind=${turn.draft.kind}, payload=${JSON.stringify(turn.draft.payload)}, approval_chain=${JSON.stringify(turn.draft.approval_chain)}, warnings=${JSON.stringify(turn.draft.warnings)}`,
    );
  }
  return sections.join("\n\n");
}

async function callJudgeSchema<T>(
  judge: Pick<ModelClient, "create" | "model">,
  system: string,
  userContent: string,
  schema: z.ZodType<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await judge.create({
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: userContent }],
        output_config: { format: { type: "json_schema", schema: jsonSchemaFor(schema) } },
      } as never);
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return schema.parse(JSON.parse(text));
    } catch (err) {
      const status =
        (err as { status?: number; statusCode?: number }).status ??
        (err as { statusCode?: number }).statusCode;
      const isTransient =
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 529 ||
        err instanceof SyntaxError;
      if (!isTransient || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

/**
 * Groundedness (SC-001, T061, evaluation/README.md):
 * - Behaviour cases (`state_gap`, `clarify`) count as passed (1.0) when the answer makes no
 *   unsupported claim and does what the case expects (states the gap or asks one clarifying question).
 * - Otherwise, judge checks each claim against the retrieved text; score = supported ÷ total claims.
 */
export async function scoreGroundedness(
  c: GoldenCase,
  turn: TurnResult,
  judge: Pick<ModelClient, "create" | "model">,
): Promise<{ score: number; rationale: string }> {
  // Behaviour-case rule (evaluation/README.md line 37).
  if (c.expected_behaviour === "state_gap") {
    const validGap =
      turn.answer.behaviour === "state_gap" &&
      turn.answer.claims.length === 0 &&
      turn.answer.gaps.length > 0;
    return {
      score: validGap ? 1 : 0,
      rationale: validGap
        ? "Behaviour rule: state_gap with no unsupported claims and stated gap."
        : `Expected state_gap with no claims, got behaviour=${turn.answer.behaviour} with ${turn.answer.claims.length} claims.`,
    };
  }

  if (c.expected_behaviour === "clarify") {
    const q = turn.answer.clarifying_question?.trim() ?? "";
    const validClarify =
      turn.answer.behaviour === "clarify" &&
      turn.answer.claims.length === 0 &&
      q.length > 0 &&
      (q.match(/\?/g) ?? []).length === 1;
    return {
      score: validClarify ? 1 : 0,
      rationale: validClarify
        ? "Behaviour rule: clarify with no unsupported claims and one clarifying question."
        : `Expected clarify with one question and no claims, got behaviour=${turn.answer.behaviour}.`,
    };
  }

  if (turn.answer.claims.length === 0) {
    return {
      score: 0,
      rationale: `Answer produced 0 claims for expected_behaviour=${c.expected_behaviour}.`,
    };
  }

  const evidence = formatTurnEvidenceForJudge(turn);
  const claimsList = turn.answer.claims
    .map((cl, idx) => `${idx + 1}. ${cl.text} [citations: ${cl.citations.map(formatCitationRef).join("; ")}]`)
    .join("\n");

  const out = await callJudgeSchema(
    judge,
    loadGroundednessPrompt(),
    `<question>${c.question}</question>\n<expected_behaviour>${c.expected_behaviour}</expected_behaviour>\n<retrieved_evidence>\n${evidence}\n</retrieved_evidence>\n<answer>\n${claimsList}\n</answer>`,
    GroundednessJudgeOutput,
  );

  if (out.claims.length === 0) {
    return { score: 0, rationale: out.rationale };
  }
  const supported = out.claims.filter((x) => x.supported).length;
  return {
    score: Number((supported / out.claims.length).toFixed(4)),
    rationale: out.rationale,
  };
}

/**
 * Citation accuracy (SC-002, T061, evaluation/README.md):
 * For each `(claim, citation)` pair, the judge checks that the cited section/edge supports the claim.
 * Cases with no expected sources and no claims (e.g. `state_gap` GS-019, `clarify` GS-029..GS-030)
 * return `score: null` (skipped).
 */
export async function scoreCitationAccuracy(
  c: GoldenCase,
  turn: TurnResult,
  judge: Pick<ModelClient, "create" | "model">,
): Promise<{ score: number | null; rationale: string }> {
  const pairs = turn.answer.claims.flatMap((cl) =>
    cl.citations.map((cit) => ({
      claim: cl.text,
      citation: formatCitationRef(cit),
    })),
  );

  if (pairs.length === 0) {
    if (
      c.expected_sources.length === 0 ||
      c.expected_behaviour === "state_gap" ||
      c.expected_behaviour === "clarify"
    ) {
      return {
        score: null,
        rationale: "Skipped: no citations expected or emitted on gap/clarify/record-refusal case.",
      };
    }
    return {
      score: 0,
      rationale: "Expected cited claims, but 0 (claim, citation) pairs were emitted.",
    };
  }

  const evidence = formatTurnEvidenceForJudge(turn);
  const pairsText = pairs
    .map((p, i) => `${i + 1}. Claim: "${p.claim}" | Cited: "${p.citation}"`)
    .join("\n");

  const out = await callJudgeSchema(
    judge,
    loadCitationPrompt(),
    `<question>${c.question}</question>\n<retrieved_evidence>\n${evidence}\n</retrieved_evidence>\n<claim_citation_pairs>\n${pairsText}\n</claim_citation_pairs>`,
    CitationJudgeOutput,
  );

  if (out.pairs.length === 0) {
    return { score: 0, rationale: out.rationale };
  }
  const supported = out.pairs.filter((p) => p.supported).length;
  return {
    score: Number((supported / out.pairs.length).toFixed(4)),
    rationale: out.rationale,
  };
}

/**
 * Answer completeness (SC-003, T061, evaluation/README.md):
 * Judge marks each `expected_answer_points` item as covered or not covered.
 * Score = covered ÷ total.
 */
export async function scoreCompleteness(
  c: GoldenCase,
  turn: TurnResult,
  judge: Pick<ModelClient, "create" | "model">,
): Promise<{ score: number | null; rationale: string }> {
  const expectedPoints = c.expected_answer_points ?? [];
  if (expectedPoints.length === 0) {
    return { score: null, rationale: "No expected_answer_points for this case." };
  }

  const pointsText = expectedPoints.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const answerText = formatTurnAnswerForJudge(turn);

  const out = await callJudgeSchema(
    judge,
    loadCompletenessPrompt(),
    `<question>${c.question}</question>\n<expected_answer_points>\n${pointsText}\n</expected_answer_points>\n<answer>\n${answerText}\n</answer>`,
    CompletenessJudgeOutput,
  );

  if (out.points.length === 0) {
    return { score: 0, rationale: out.rationale };
  }
  const covered = out.points.filter((p) => p.covered).length;
  return {
    score: Number((covered / expectedPoints.length).toFixed(4)),
    rationale: out.rationale,
  };
}

export interface Tier2Options extends Tier1bOptions {
  judgeModel?: Pick<ModelClient, "create" | "model">;
  judgeConcurrency?: number;
}

/**
 * Tier 2 full evaluation runner (T061, FR-020, SC-001, SC-002, SC-003):
 * Runs Tier 1a + Tier 1b in the requested modes (`baseline`, `graphrag`, or both),
 * then scores every turn with `JUDGE_MODEL` (`claude-opus-5-5`, effort `medium`).
 */
export async function runTier2(
  cases: GoldenCase[],
  modes: Mode[],
  opts: Tier2Options = {},
): Promise<CaseResult[]> {
  const judge = opts.judgeModel ?? createClient("judge");
  const judgeConcurrency = Math.max(1, opts.judgeConcurrency ?? 3);
  const caseById = new Map(cases.map((c) => [c.id, c]));

  const { results, turns } = await runTier1b(cases, modes, opts);

  // Load corpus chunks so that when a turn retrieves documents via deterministic tools or graph
  // edges (`check_policy`, `propose_access_request`, `lookup_approvals`, `graph_query`), the judge
  // can inspect the text of the retrieved document sections alongside the tool output.
  let chunksByDoc = new Map<string, { doc_id: string; section: string; text: string }[]>();
  try {
    const rows = (await sql`SELECT doc_id, section, text FROM chunks ORDER BY doc_id, id`) as {
      doc_id: string;
      section: string;
      text: string;
    }[];
    for (const row of rows) {
      const list = chunksByDoc.get(row.doc_id) ?? [];
      list.push(row);
      chunksByDoc.set(row.doc_id, list);
    }
  } catch {
    chunksByDoc = new Map();
  }

  for (const turn of turns.values()) {
    const existingDocs = new Set(
      (turn.evidence_excerpts ?? []).map((e) => `${e.doc_id}::${e.section}`),
    );
    const citedDocSections = new Map<string, Set<string>>();
    for (const cit of turn.citations) {
      if ("edge" in cit) {
        if (cit.edge.source_doc) {
          const s = citedDocSections.get(cit.edge.source_doc) ?? new Set();
          citedDocSections.set(cit.edge.source_doc, s);
        }
      } else {
        const s = citedDocSections.get(cit.doc_id) ?? new Set();
        if (cit.section && cit.section !== "*") s.add(cit.section);
        citedDocSections.set(cit.doc_id, s);
      }
    }
    for (const e of turn.graph_path.edges) {
      if (e.source_doc) {
        const s = citedDocSections.get(e.source_doc) ?? new Set();
        citedDocSections.set(e.source_doc, s);
      }
    }
    for (const pc of turn.draft?.policy_citations ?? []) {
      const docId = pc.trim().split(/\s+/)[0];
      if (docId) {
        const s = citedDocSections.get(docId) ?? new Set();
        citedDocSections.set(docId, s);
      }
    }

    const extra: { doc_id: string; section: string; text: string }[] = [];
    for (const [docId, sections] of citedDocSections.entries()) {
      const allDocChunks = chunksByDoc.get(docId) ?? [];
      const matchingChunks = sections.size > 0
        ? allDocChunks.filter((ch) =>
            Array.from(sections).some(
              (sec) =>
                ch.section === sec ||
                ch.section.includes(sec) ||
                sec.includes(ch.section),
            ),
          )
        : allDocChunks.slice(0, 5);

      for (const ch of matchingChunks.length > 0 ? matchingChunks : allDocChunks.slice(0, 3)) {
        const key = `${ch.doc_id}::${ch.section}`;
        if (!existingDocs.has(key)) {
          existingDocs.add(key);
          extra.push(ch);
        }
      }
    }
    if (extra.length > 0) {
      turn.evidence_excerpts = [...(turn.evidence_excerpts ?? []), ...extra];
    }
  }

  // Cache judge scores by (case_id, answer_markdown, citations) so identical non-graph turns
  // across baseline and graphrag are judged once and applied consistently to both modes.
  const judgeCache = new Map<
    string,
    Promise<{
      groundedness: number | null;
      citation_accuracy: number | null;
      completeness: number | null;
      judge_rationale: NonNullable<CaseResult["judge_rationale"]>;
    }>
  >();

  let cursor = 0;
  const workers = Array.from({ length: Math.min(judgeConcurrency, results.length) }, async () => {
    while (cursor < results.length) {
      const idx = cursor++;
      const r = results[idx];
      const c = caseById.get(r.case_id);
      const turn = turns.get(turnKey(r.run ?? 1, r.case_id, r.mode));
      if (!c || !turn) continue;

      const sig = `${c.id}|${turn.answer.behaviour}|${turn.answer.markdown}|${JSON.stringify(turn.citations)}`;
      let pending = judgeCache.get(sig);
      if (!pending) {
        pending = (async () => {
          const [g, cit, comp] = await Promise.all([
            scoreGroundedness(c, turn, judge),
            scoreCitationAccuracy(c, turn, judge),
            scoreCompleteness(c, turn, judge),
          ]);
          return {
            groundedness: g.score,
            citation_accuracy: cit.score,
            completeness: comp.score,
            judge_rationale: {
              groundedness: g.rationale,
              citation_accuracy: cit.rationale,
              completeness: comp.rationale,
            },
          };
        })();
        judgeCache.set(sig, pending);
      }

      const scored = await pending;
      r.groundedness = scored.groundedness;
      r.citation_accuracy = scored.citation_accuracy;
      r.completeness = scored.completeness;
      r.judge_rationale = scored.judge_rationale;
    }
  });

  await Promise.all(workers);
  return results;
}
