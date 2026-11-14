import { readFileSync } from "node:fs";
import path from "node:path";
import type { ModelClient } from "@/lib/model";
import { computeConfidence, filterCitations, renderMarkdown, type RetrievedSet } from "./answer";
import { FinalAnswer, jsonSchemaFor, type Confidence } from "./schemas";

export type RefusalKind = "bypass_approval" | "bulk_export" | "record_exfiltration";

export interface RefuseEvidenceChunk {
  doc_id: string;
  section: string;
  effective_date: string;
  title: string;
  is_authoritative: boolean;
  text: string;
}

export const REFUSE_EVIDENCE: RefuseEvidenceChunk[] = [
  {
    doc_id: "PRC-012",
    section: "7. Emergency Access",
    effective_date: "2026-07-15",
    title: "Access Request and Approval Procedure",
    is_authoritative: true,
    text: "Standard approvals cannot be bypassed. For genuine operational incidents, Security Governance (Priya Nair) may grant emergency break-glass access for up to 24 hours under PRC-012 §7, logged in Gatekeeper IAM and reviewed retrospectively within 2 business days.",
  },
  {
    doc_id: "POL-041",
    section: "2.2 Just-in-Time Sessions",
    effective_date: "2026-06-01",
    title: "Privileged Access Management Policy",
    is_authoritative: true,
    text: "Privileged and administrative sessions are provisioned just-in-time through the PAM vault in Gatekeeper IAM for a maximum of 8 hours per session with full session recording, and may not bypass Security Governance approval.",
  },
  {
    doc_id: "POL-014",
    section: "3.5 Bulk Export",
    effective_date: "2026-08-01",
    title: "Customer Data Access and Handling Policy",
    is_authoritative: true,
    text: "Bulk exports exceeding 1,000 customer records from Lumen Data Warehouse require prior written approval from the data owner, Mei Lin Tan (CTL-08). Export blocking and DLP alerting (CTL-06) enforce this control.",
  },
  {
    doc_id: "PRC-012",
    section: "1. Scope",
    effective_date: "2026-07-15",
    title: "Access Request and Approval Procedure",
    is_authoritative: true,
    text: "All requests for access to Kestrel Financial Group systems and data follow the standard access request and approval workflow in PRC-012. This governance corpus contains access policies and procedures only, not customer records or employee personal data; accessing customer data in operational systems such as Atlas CRM requires a standard access request under PRC-012.",
  },
];

let refusePrompt: string | undefined;
export const loadRefusePrompt = () =>
  (refusePrompt ??= readFileSync(path.join(process.cwd(), "lib/agent/prompts/refuse.md"), "utf8"));

export interface RefuseRouteResult {
  kind: RefusalKind;
  answer: FinalAnswer;
  confidence: Confidence;
  markdown: string;
  retrieved: RetrievedSet;
  dropped_citations: number;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface RefuseRouteDeps {
  model?: Pick<ModelClient, "create" | "model">;
  preRule?: string | null;
}

const BULK_EXPORT_RE =
  /\b(bulk\s+export|export\b[^.?!]{0,40}\b(all|csv|customer|pii|records|data|warehouse)|over\s+1,?000\s+records)\b/i;

const RECORD_EXFIL_RE =
  /\b((home\s+)?addresses|phone\s+numbers|social\s+security|salary|salaries|personal\s+(details|data|records))\b|\b(list|show|give\s+me|dump|send\s+me)\b[^.?!]{0,40}\b(customers?|customer\s+records|employees?'?\s*(records|details|addresses|emails))\b/i;

export function classifyRefusalKind(question: string, preRule?: string | null): RefusalKind {
  if (preRule === "bulk_export" || BULK_EXPORT_RE.test(question)) {
    return "bulk_export";
  }
  if (preRule === "record_request" || RECORD_EXFIL_RE.test(question)) {
    return "record_exfiltration";
  }
  return "bypass_approval";
}

export function buildDeterministicRefusal(kind: RefusalKind): FinalAnswer {
  if (kind === "bulk_export") {
    return {
      behaviour: "refuse",
      claims: [
        {
          text: "I must refuse this request: the copilot holds governance knowledge, not customer records, and cannot export data or disregard its governance instructions.",
          key: true,
          citations: [{ doc_id: "POL-014", section: "3.5 Bulk Export" }],
          source_status: "effective_policy",
        },
        {
          text: "Under POL-014 §3.5 (control CTL-08), bulk export of more than 1,000 customer records from Lumen Data Warehouse requires prior written approval from the data owner, Mei Lin Tan.",
          key: true,
          citations: [{ doc_id: "POL-014", section: "3.5 Bulk Export" }],
          source_status: "effective_policy",
        },
      ],
      assumptions: [],
      gaps: [],
      clarifying_question: null,
      legitimate_path:
        "Under POL-014 §3.5, any bulk export over 1,000 customer records requires prior written approval from the data owner, Mei Lin Tan, before running the export through the governed data platform.",
    };
  }

  if (kind === "record_exfiltration") {
    return {
      behaviour: "refuse",
      claims: [
        {
          text: "I must refuse this request: the copilot holds governance knowledge, not customer records or employee personal data, so it cannot retrieve or list customer home addresses or records.",
          key: true,
          citations: [{ doc_id: "PRC-012", section: "1. Scope" }],
          source_status: "effective_policy",
        },
      ],
      assumptions: [],
      gaps: [],
      clarifying_question: null,
      legitimate_path:
        "This copilot holds governance knowledge, not customer records; if you have a legitimate business need to access customer data in Atlas CRM, raise a standard access request under PRC-012 for sponsor and data owner approval.",
    };
  }

  return {
    behaviour: "refuse",
    claims: [
      {
        text: "I cannot grant access or skip required organisational approvals. All access requests must complete the required approval chain and cannot bypass controls.",
        key: true,
        citations: [
          { doc_id: "PRC-012", section: "7. Emergency Access" },
          { doc_id: "POL-041", section: "2.2 Just-in-Time Sessions" },
        ],
        source_status: "effective_policy",
      },
      {
        text: "For urgent operational incidents, PRC-012 §7 allows Security Governance (Priya Nair) to grant emergency access for up to 24 hours (with privileged PAM vault sessions capped at 8 hours under POL-041 §2.2), subject to retrospective audit.",
        key: true,
        citations: [
          { doc_id: "PRC-012", section: "7. Emergency Access" },
          { doc_id: "POL-041", section: "2.2 Just-in-Time Sessions" },
        ],
        source_status: "effective_policy",
      },
    ],
    assumptions: [],
    gaps: [],
    clarifying_question: null,
    legitimate_path:
      "Under PRC-012 §7, Security Governance (Priya Nair) can grant emergency access for up to 24 hours for genuine urgent incidents (with privileged PAM sessions limited to 8 hours under POL-041 §2.2), or you can submit a standard access request under PRC-012.",
  };
}

function formatRefuseEvidence(chunks: RefuseEvidenceChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `<excerpt n="${i + 1}" doc_id="${c.doc_id}" section="${c.section}" effective_date="${c.effective_date}" status="effective_policy" title="${c.title}">\n${c.text}\n</excerpt>`,
    )
    .join("\n\n");
}

function retrievedForKind(kind: RefusalKind): RetrievedSet {
  const docs =
    kind === "bulk_export"
      ? REFUSE_EVIDENCE.filter((c) => c.doc_id === "POL-014")
      : kind === "record_exfiltration"
        ? REFUSE_EVIDENCE.filter((c) => c.doc_id === "PRC-012" && c.section === "1. Scope")
        : REFUSE_EVIDENCE.filter((c) => c.doc_id === "PRC-012" || c.doc_id === "POL-041");
  return {
    chunks: docs.map((c) => ({
      doc_id: c.doc_id,
      section: c.section,
      is_authoritative: c.is_authoritative,
    })),
    edges: [],
  };
}

/**
 * `refuse` route (T051, FR-012):
 * - Offers NO tools (never passes `tools` to the model, never executes any MCP tool).
 * - Always returns `behaviour: "refuse"` with a constructive `legitimate_path`:
 *   - `PRC-012 §7` emergency access up to 24h via Security Governance (`bypass_approval`)
 *   - `POL-014 §3.5` bulk export >1,000 records requires data owner Mei Lin Tan written approval (`bulk_export`)
 *   - "holds governance knowledge, not customer records" + standard access request process (`record_exfiltration`)
 */
export async function answerRefuseRoute(
  question: string,
  deps: RefuseRouteDeps = {},
): Promise<RefuseRouteResult> {
  const kind = classifyRefusalKind(question, deps.preRule);
  const fallback = buildDeterministicRefusal(kind);
  const retrieved = retrievedForKind(kind);

  if (!deps.model) {
    const { dropped, ...filtered } = filterCitations(fallback, retrieved);
    return {
      kind,
      answer: filtered,
      confidence: computeConfidence(filtered, retrieved),
      markdown: renderMarkdown(filtered),
      retrieved,
      dropped_citations: dropped,
    };
  }

  const allRetrieved: RetrievedSet = {
    chunks: REFUSE_EVIDENCE.map((c) => ({
      doc_id: c.doc_id,
      section: c.section,
      is_authoritative: c.is_authoritative,
    })),
    edges: [],
  };

  // No tools are offered on the refuse route (FR-012).
  const res = await deps.model.create({
    max_tokens: 2000,
    system: loadRefusePrompt(),
    messages: [
      {
        role: "user",
        content: `<evidence>\n${formatRefuseEvidence(REFUSE_EVIDENCE)}\n</evidence>\n\n<question>${question}</question>`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: jsonSchemaFor(FinalAnswer) } },
  } as never);

  const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };

  if (res.stop_reason === "refusal") {
    const { dropped, ...filtered } = filterCitations(fallback, retrieved);
    return {
      kind,
      answer: filtered,
      confidence: computeConfidence(filtered, retrieved),
      markdown: renderMarkdown(filtered),
      retrieved,
      dropped_citations: dropped,
      usage,
    };
  }

  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = FinalAnswer.parse(JSON.parse(text));
  const { dropped, ...filtered } = filterCitations(parsed, allRetrieved);

  const normalized: FinalAnswer = {
    ...filtered,
    behaviour: "refuse",
    clarifying_question: null,
    claims: filtered.claims.length > 0 ? filtered.claims : fallback.claims,
    legitimate_path: filtered.legitimate_path?.trim()
      ? filtered.legitimate_path
      : fallback.legitimate_path,
  };

  return {
    kind,
    answer: normalized,
    confidence: computeConfidence(normalized, allRetrieved),
    markdown: renderMarkdown(normalized),
    retrieved: allRetrieved,
    dropped_citations: dropped,
    usage,
  };
}
