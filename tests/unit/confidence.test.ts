import { describe, expect, it } from "vitest";
import {
  computeConfidence,
  filterCitations,
  renderMarkdown,
  type RetrievedSet,
} from "@/lib/agent/answer";
import type { Claim, FinalAnswer } from "@/lib/agent/schemas";

const retrieved: RetrievedSet = {
  chunks: [
    { doc_id: "POL-014", section: "3. Requirements > 3.4", is_authoritative: true },
    { doc_id: "REF-005", section: "1. Standard access (read or write)", is_authoritative: true },
    {
      doc_id: "MTG-2026-10-14",
      section: "2. Proposal: Privacy Officer approval",
      is_authoritative: false,
    },
  ],
  edges: [
    { source: "SYS-CRM", relation: "data_owner", target: "PER-TGALLAGHER", source_doc: "REF-003" },
  ],
};

const claim = (over: Partial<Claim>): Claim => ({
  text: "t",
  key: true,
  citations: [],
  source_status: "effective_policy",
  ...over,
});

const answer = (claims: Claim[], over: Partial<FinalAnswer> = {}): FinalAnswer => ({
  behaviour: "answer",
  claims,
  assumptions: [],
  gaps: [],
  clarifying_question: null,
  legitimate_path: null,
  ...over,
});

describe("filterCitations (FR-006, Constitution I)", () => {
  it("keeps retrieved citations and canonicalises short section forms", () => {
    const out = filterCitations(
      answer([
        claim({
          citations: [
            { doc_id: "POL-014", section: "§3.4" },
            { doc_id: "POL-014", section: "3.4" },
            { doc_id: "POL-014", section: "3. Requirements > 3.4" },
          ],
        }),
      ]),
      retrieved,
    );
    expect(out.claims[0].citations).toEqual([
      { doc_id: "POL-014", section: "3. Requirements > 3.4" },
    ]);
  });

  it("drops citations that were not retrieved this turn (doc, section or edge)", () => {
    const out = filterCitations(
      answer([
        claim({
          citations: [
            { doc_id: "POL-099", section: "1" },
            { doc_id: "POL-014", section: "9.9" },
            {
              edge: {
                source: "SYS-CRM",
                relation: "data_owner",
                target: "PER-X",
                source_doc: "REF-003",
              },
            },
            {
              edge: {
                source: "SYS-CRM",
                relation: "data_owner",
                target: "PER-TGALLAGHER",
                source_doc: "REF-003",
              },
            },
          ],
        }),
      ]),
      retrieved,
    );
    expect(out.claims[0].citations).toEqual([
      {
        edge: {
          source: "SYS-CRM",
          relation: "data_owner",
          target: "PER-TGALLAGHER",
          source_doc: "REF-003",
        },
      },
    ]);
    expect(out.dropped).toBe(3);
  });

  it("matches a section by its heading-number prefix", () => {
    const out = filterCitations(
      answer([claim({ citations: [{ doc_id: "REF-005", section: "§1" }] })]),
      retrieved,
    );
    expect(out.claims[0].citations).toEqual([
      { doc_id: "REF-005", section: "1. Standard access (read or write)" },
    ]);
  });
});

describe("computeConfidence (clarification 3)", () => {
  const cited = { doc_id: "POL-014", section: "3. Requirements > 3.4" };
  const mtg = { doc_id: "MTG-2026-10-14", section: "2. Proposal: Privacy Officer approval" };

  it("high when every key claim is cited by effective policy and nothing is assumed or missing", () => {
    expect(computeConfidence(answer([claim({ citations: [cited] })]), retrieved)).toBe("high");
  });

  it("low when a key claim is uncited", () => {
    expect(computeConfidence(answer([claim({ citations: [] })]), retrieved)).toBe("low");
  });

  it("low when a key claim rests only on proposal or meeting material", () => {
    const a = answer([claim({ citations: [mtg], source_status: "proposal_or_meeting" })]);
    expect(computeConfidence(a, retrieved)).toBe("low");
  });

  it("low when a key claim's citations conflict (policy and meeting note together)", () => {
    expect(computeConfidence(answer([claim({ citations: [cited, mtg] })]), retrieved)).toBe("low");
  });

  it("an uncited non-key claim does not lower confidence to low", () => {
    const a = answer([claim({ citations: [cited] }), claim({ key: false, citations: [] })]);
    expect(computeConfidence(a, retrieved)).toBe("high");
  });

  it("medium when assumptions or gaps are present", () => {
    expect(
      computeConfidence(answer([claim({ citations: [cited] })], { gaps: ["x"] }), retrieved),
    ).toBe("medium");
    expect(
      computeConfidence(answer([claim({ citations: [cited] })], { assumptions: ["y"] }), retrieved),
    ).toBe("medium");
  });

  it("low for an answer with no key claims", () => {
    expect(computeConfidence(answer([claim({ key: false, citations: [cited] })]), retrieved)).toBe(
      "low",
    );
  });
});

describe("renderMarkdown (LLM05)", () => {
  it("renders claims with citation chips and escapes raw HTML", () => {
    const md = renderMarkdown(
      answer(
        [
          claim({
            text: "Max <b>90</b> days & renewable once.",
            citations: [{ doc_id: "POL-014", section: "3. Requirements > 3.4" }],
          }),
        ],
        { gaps: ["No <script> data"] },
      ),
    );
    expect(md).toContain("Max &lt;b&gt;90&lt;/b&gt; days &amp; renewable once.");
    expect(md).toContain("`POL-014 §3.4`");
    expect(md).not.toContain("<script>");
  });
});
