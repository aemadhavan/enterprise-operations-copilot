import { randomUUID } from "node:crypto";
import { writeAudit, type WriteAuditInput } from "@/lib/audit/audit";
import { sql } from "@/lib/db/client";
import { loadGraphSnapshot } from "@/lib/graph/snapshot";
import {
  resolveApprovals,
  type AccessLevel,
  type Graph,
  type RequesterType,
} from "@/lib/policy/approvals";
import {
  checkPolicy,
  resolveVendor,
  SCENARIO_TODAY,
  type PolicyBreach,
  type PolicyWarning,
} from "@/lib/policy/checks";
import { checkSeparationOfDuties, type SodWarning } from "@/lib/policy/sod";

export type DraftStatus = "proposed" | "confirmed" | "cancelled" | "superseded";
export type DraftKind = "access_request" | "onboarding_ticket";

export type DraftWarning = SodWarning | PolicyWarning;

export interface VendorFlag {
  vendor: string;
  status: "expired" | "expires_before_end_date";
  valid_until: string;
  end_date: string;
  message: string;
  citation: string;
}

export interface DraftApprovalStep {
  seq: number;
  role: string;
  approval_id: string;
  approver_name: string | null;
  source_doc: string;
}

export interface AccessRequestPayload {
  requester_name: string;
  requester_type: RequesterType;
  sponsor: string;
  system_id: string;
  access_level: AccessLevel;
  duration_days: number;
  justification: string;
  vendor?: string;
  contractor_name?: string;
  start_date?: string;
  end_date?: string;
  restricted_access_expected?: boolean;
  vendor_flag?: VendorFlag | null;
}

export interface CreateOnboardingDraftInput {
  contractor_name?: string | null;
  vendor?: string | null;
  sponsor?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  restricted_access_expected?: boolean | null;
  supersedes_draft_id?: string | null;
  conversation_id?: string | null;
}

export interface DraftRecord {
  draft_id: string;
  lineage_id: string;
  version: number;
  kind: DraftKind;
  payload: AccessRequestPayload;
  approval_chain: DraftApprovalStep[];
  warnings: DraftWarning[];
  policy_citations: string[];
  status: DraftStatus;
  conversation_id: string | null;
  created_at?: string;
}

export interface CreateDraftInput {
  requester_name?: string | null;
  requester_type?: RequesterType | null;
  sponsor?: string | null;
  system_id?: string | null;
  access_level?: AccessLevel | null;
  duration_days?: number | null;
  justification?: string | null;
  vendor?: string | null;
  supersedes_draft_id?: string | null;
  conversation_id?: string | null;
}

export const REQUIRED_ACCESS_REQUEST_FIELDS = [
  "requester_name",
  "requester_type",
  "sponsor",
  "system_id",
  "access_level",
  "duration_days",
  "justification",
] as const;

export type CreateDraftResult =
  | { status: "drafted"; draft: DraftRecord; vendor_flag?: VendorFlag | null }
  | { status: "needs_fields"; missing: string[] }
  | {
      status: "blocked";
      breaches: PolicyBreach[];
      missing: string[];
      policy_citations: string[];
    };

export interface CancelDraftResult {
  ok: boolean;
  code?: "not_found" | "draft_not_submittable";
  draft?: DraftRecord;
}

export interface DraftStore {
  getById(draft_id: string): Promise<DraftRecord | null>;
  insert(row: DraftRecord): Promise<DraftRecord>;
  updateStatus(draft_id: string, from: DraftStatus, to: DraftStatus): Promise<boolean>;
}

export interface DraftDeps {
  graph?: () => Promise<Graph>;
  audit?: (entry: WriteAuditInput) => Promise<unknown>;
  store?: DraftStore;
}

const pgStore: DraftStore = {
  async getById(draft_id: string): Promise<DraftRecord | null> {
    const rows = (await sql`
      SELECT
        draft_id::text AS draft_id,
        lineage_id::text AS lineage_id,
        version::int AS version,
        kind,
        payload,
        approval_chain,
        warnings,
        policy_citations,
        status,
        conversation_id,
        created_at::text AS created_at
      FROM drafts
      WHERE draft_id = ${draft_id}::uuid
    `) as DraftRecord[];
    return rows[0] ?? null;
  },

  async insert(row: DraftRecord): Promise<DraftRecord> {
    const rows = (await sql`
      INSERT INTO drafts (
        draft_id, lineage_id, version, kind, payload,
        approval_chain, warnings, policy_citations, status, conversation_id
      ) VALUES (
        ${row.draft_id}::uuid,
        ${row.lineage_id}::uuid,
        ${row.version},
        ${row.kind},
        ${JSON.stringify(row.payload)}::jsonb,
        ${JSON.stringify(row.approval_chain)}::jsonb,
        ${JSON.stringify(row.warnings)}::jsonb,
        ${row.policy_citations}::text[],
        ${row.status},
        ${row.conversation_id}
      )
      RETURNING
        draft_id::text AS draft_id,
        lineage_id::text AS lineage_id,
        version::int AS version,
        kind,
        payload,
        approval_chain,
        warnings,
        policy_citations,
        status,
        conversation_id,
        created_at::text AS created_at
    `) as DraftRecord[];
    return rows[0];
  },

  async updateStatus(draft_id: string, from: DraftStatus, to: DraftStatus): Promise<boolean> {
    const rows = (await sql`
      UPDATE drafts
      SET status = ${to}
      WHERE draft_id = ${draft_id}::uuid AND status = ${from}
      RETURNING draft_id
    `) as { draft_id: string }[];
    return rows.length > 0;
  },
};

export function findMissingAccessFields(input: CreateDraftInput): string[] {
  const missing: string[] = [];
  if (!input.requester_name?.trim()) missing.push("requester_name");
  if (!input.requester_type) missing.push("requester_type");
  if (!input.sponsor?.trim()) missing.push("sponsor");
  if (!input.system_id?.trim()) missing.push("system_id");
  if (!input.access_level) missing.push("access_level");
  if (typeof input.duration_days !== "number" || input.duration_days <= 0) {
    missing.push("duration_days");
  }
  if (!input.justification?.trim()) missing.push("justification");
  return missing;
}

/**
 * Create or supersede an immutable access-request draft (T043, FR-009, FR-011, FR-023):
 * 1. Runs `checkPolicy` FIRST (even if some fields are still missing, e.g. GS-023).
 *    A policy breach writes a `blocked` audit row and creates no draft.
 * 2. Validates required fields (`requester_name, requester_type, sponsor, system_id,
 *    access_level, duration_days, justification`); returns `needs_fields` when incomplete.
 * 3. Resolves the REF-005 approval chain, attaches any separation-of-duties or vendor warnings,
 *    supersedes any prior version (`version + 1` in the same `lineage_id`), writes `proposed` to
 *    `audit_log`, and returns the new `proposed` draft.
 */
export async function createDraft(
  input: CreateDraftInput,
  deps: DraftDeps = {},
): Promise<CreateDraftResult> {
  const store = deps.store ?? pgStore;
  const audit = deps.audit ?? writeAudit;
  const loadGraph = deps.graph ?? loadGraphSnapshot;

  const missing = findMissingAccessFields(input);

  // Step 1: Policy check runs BEFORE missing-fields gate (FR-011, GS-023).
  if (input.requester_type) {
    const policy = checkPolicy({
      system_id: input.system_id ?? undefined,
      requester_type: input.requester_type,
      access_level: input.access_level ?? undefined,
      duration_days: input.duration_days ?? undefined,
      vendor: input.vendor ?? undefined,
    });
    if (!policy.ok) {
      await audit({
        actor: input.sponsor || input.requester_name || "anonymous",
        event: "blocked",
        details: {
          breaches: policy.breaches,
          missing,
          system_id: input.system_id ?? null,
          duration_days: input.duration_days ?? null,
          access_level: input.access_level ?? null,
          vendor: input.vendor ?? null,
        },
        policy_citations: policy.citations,
      });
      return {
        status: "blocked",
        breaches: policy.breaches,
        missing,
        policy_citations: policy.citations,
      };
    }
  }

  // Step 2: Required fields check (FR-009).
  if (missing.length > 0) {
    return { status: "needs_fields", missing };
  }

  const payload: AccessRequestPayload = {
    requester_name: input.requester_name!.trim(),
    requester_type: input.requester_type!,
    sponsor: input.sponsor!.trim(),
    system_id: input.system_id!.trim(),
    access_level: input.access_level!,
    duration_days: input.duration_days!,
    justification: input.justification!.trim(),
    ...(input.vendor?.trim() ? { vendor: input.vendor.trim() } : {}),
  };

  const policy = checkPolicy(payload);
  const graph = await loadGraph();
  const resolved = resolveApprovals(graph, payload);

  // Map `line_manager` (APR-LM) to `sponsor` per contracts/http-api.md and data-model.md.
  const approval_chain: DraftApprovalStep[] = resolved.chain.map((step) => ({
    seq: step.seq,
    role: step.role === "line_manager" ? "sponsor" : step.role,
    approval_id: step.approval_id,
    approver_name: step.approver_name,
    source_doc: step.source_doc,
  }));

  const warnings: DraftWarning[] = [...policy.warnings];
  const sod = checkSeparationOfDuties(resolved.chain, payload.sponsor);
  if (sod) warnings.unshift(sod);
  if (
    (payload.requester_type === "Contractor" || payload.requester_type === "Vendor") &&
    !payload.vendor
  ) {
    warnings.push({
      code: "vendor_not_stated",
      message: "Vendor not stated (assumed independent contractor, not vendor staff).",
      citation: "POL-022 §5",
    });
  }

  const policy_citations = [
    ...new Set([
      "REF-003",
      ...resolved.chain.map((c) => c.source_doc),
      ...resolved.prerequisites.map((p) => p.source_doc),
      ...resolved.controls.map((c) => c.source_doc),
      ...policy.citations,
    ]),
  ];

  let lineage_id: string = randomUUID();
  let version = 1;

  if (input.supersedes_draft_id) {
    const prev = await store.getById(input.supersedes_draft_id);
    if (!prev || prev.status !== "proposed") {
      throw new Error(
        `Cannot supersede draft ${input.supersedes_draft_id}: must exist with status 'proposed'`,
      );
    }
    const ok = await store.updateStatus(prev.draft_id, "proposed", "superseded");
    if (!ok) {
      throw new Error(`Draft ${prev.draft_id} is no longer in 'proposed' state`);
    }
    await audit({
      actor: payload.sponsor,
      event: "superseded",
      draft_id: prev.draft_id,
      details: { superseded_by_version: prev.version + 1 },
      policy_citations: prev.policy_citations,
    });
    lineage_id = prev.lineage_id;
    version = prev.version + 1;
  }

  const draftRow: DraftRecord = {
    draft_id: randomUUID(),
    lineage_id,
    version,
    kind: "access_request",
    payload,
    approval_chain,
    warnings,
    policy_citations,
    status: "proposed",
    conversation_id: input.conversation_id ?? null,
  };

  const saved = await store.insert(draftRow);
  await audit({
    actor: payload.sponsor,
    event: "proposed",
    draft_id: saved.draft_id,
    details: {
      version: saved.version,
      lineage_id: saved.lineage_id,
      system_id: payload.system_id,
      requester_name: payload.requester_name,
      requester_type: payload.requester_type,
      access_level: payload.access_level,
      duration_days: payload.duration_days,
    },
    policy_citations,
  });

  return { status: "drafted", draft: saved };
}

export async function getDraft(
  draft_id: string,
  deps: Pick<DraftDeps, "store"> = {},
): Promise<DraftRecord | null> {
  return (deps.store ?? pgStore).getById(draft_id);
}

export async function cancelDraft(
  draft_id: string,
  actor = "anonymous",
  deps: Pick<DraftDeps, "store" | "audit"> = {},
): Promise<CancelDraftResult> {
  const store = deps.store ?? pgStore;
  const audit = deps.audit ?? writeAudit;
  const existing = await store.getById(draft_id);
  if (!existing) return { ok: false, code: "not_found" };
  if (existing.status !== "proposed") {
    return { ok: false, code: "draft_not_submittable", draft: existing };
  }
  const updated = await store.updateStatus(draft_id, "proposed", "cancelled");
  if (!updated) {
    return { ok: false, code: "draft_not_submittable", draft: existing };
  }
  await audit({
    actor,
    event: "cancelled",
    draft_id,
    details: { version: existing.version },
    policy_citations: existing.policy_citations,
  });
  return { ok: true, draft: { ...existing, status: "cancelled" } };
}

export function findMissingOnboardingFields(input: CreateOnboardingDraftInput): string[] {
  const missing: string[] = [];
  if (!input.contractor_name?.trim()) missing.push("contractor_name");
  if (!input.start_date?.trim()) missing.push("start_date");
  if (!input.end_date?.trim()) missing.push("end_date");
  return missing;
}

function diffDaysIso(startIso: string, endIso: string): number {
  const s = Date.parse(`${startIso}T00:00:00Z`);
  const e = Date.parse(`${endIso}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 90;
  return Math.max(1, Math.round((e - s) / 86_400_000));
}

/**
 * Create or supersede an immutable contractor onboarding-ticket draft (T069, FR-026, GS-024):
 * - Validates `contractor_name`, `start_date`, `end_date`.
 * - Resolves vendor assessment status against `SCENARIO_TODAY` (2026-11-13) and `end_date` (VND-002),
 *   attaching `vendor_flag` when the supplier assessment is expired or expires before `end_date`.
 * - Notes missing `sponsor` when not provided (GS-024: "sponsor missing, so asking for it is a plus").
 */
export async function createOnboardingDraft(
  input: CreateOnboardingDraftInput,
  deps: DraftDeps = {},
): Promise<CreateDraftResult> {
  const store = deps.store ?? pgStore;
  const audit = deps.audit ?? writeAudit;

  const missing = findMissingOnboardingFields(input);
  if (missing.length > 0) {
    return { status: "needs_fields", missing };
  }

  const contractor_name = input.contractor_name!.trim();
  const start_date = input.start_date!.trim();
  const end_date = input.end_date!.trim();
  const vendorRaw = input.vendor?.trim() || undefined;
  const rawSponsor = input.sponsor?.trim() ?? "";
  const sponsorMissing =
    !rawSponsor || /^(tbd|unknown|not[ _-]?stated|not[ _-]?provided|missing|none|n\/a)$/i.test(rawSponsor);
  const sponsor = sponsorMissing ? "TBD (sponsor required)" : rawSponsor;
  const restricted_access_expected = Boolean(input.restricted_access_expected);

  const warnings: DraftWarning[] = [];
  const policyCitationsSet = new Set<string>(["PRC-007", "POL-022"]);
  let vendor_flag: VendorFlag | null = null;

  const vendorMeta = resolveVendor(vendorRaw);
  if (vendorMeta) {
    policyCitationsSet.add("VND-002");
    if (vendorMeta.valid_until < SCENARIO_TODAY) {
      vendor_flag = {
        vendor: vendorMeta.name,
        status: "expired",
        valid_until: vendorMeta.valid_until,
        end_date,
        message: `${vendorMeta.name}'s Supplier Security Assessment expired on ${vendorMeta.valid_until}; renewal is required before onboarding (VND-002 §3).`,
        citation: "VND-002 §3",
      };
      warnings.push({
        code: "vendor_assessment_expires_before_end",
        message: vendor_flag.message,
        citation: vendor_flag.citation,
        valid_until: vendorMeta.valid_until,
      });
    } else if (end_date > vendorMeta.valid_until) {
      vendor_flag = {
        vendor: vendorMeta.name,
        status: "expires_before_end_date",
        valid_until: vendorMeta.valid_until,
        end_date,
        message: `${vendorMeta.name}'s Supplier Security Assessment is only valid until ${vendorMeta.valid_until}, which expires during the engagement (before ${end_date}), so renewal is needed (VND-002 Appendix A).`,
        citation: "VND-002 Appendix A",
      };
      warnings.push({
        code: "vendor_assessment_expires_before_end",
        message: vendor_flag.message,
        citation: vendor_flag.citation,
        valid_until: vendorMeta.valid_until,
      });
    }
  } else if (vendorRaw) {
    policyCitationsSet.add("VND-002");
  }

  if (sponsorMissing) {
    warnings.push({
      code: "sponsor_not_stated",
      message:
        "Sponsor was not specified; a Kestrel line-manager sponsor must be named before onboarding starts (PRC-007 Step 1).",
      citation: "PRC-007",
    });
  }

  const duration_days = diffDaysIso(start_date, end_date);
  const payload: AccessRequestPayload = {
    requester_name: contractor_name,
    requester_type: vendorRaw ? "Vendor" : "Contractor",
    sponsor,
    system_id: "SYS-HELP",
    access_level: "read",
    duration_days,
    justification: `Contractor onboarding (${start_date} to ${end_date})`,
    ...(vendorMeta ? { vendor: vendorMeta.name } : vendorRaw ? { vendor: vendorRaw } : {}),
    contractor_name,
    start_date,
    end_date,
    restricted_access_expected,
    vendor_flag,
  };

  const policy_citations = [...policyCitationsSet];
  let lineage_id: string = randomUUID();
  let version = 1;

  if (input.supersedes_draft_id) {
    const prev = await store.getById(input.supersedes_draft_id);
    if (!prev || prev.status !== "proposed") {
      throw new Error(
        `Cannot supersede draft ${input.supersedes_draft_id}: must exist with status 'proposed'`,
      );
    }
    const ok = await store.updateStatus(prev.draft_id, "proposed", "superseded");
    if (!ok) {
      throw new Error(`Draft ${prev.draft_id} is no longer in 'proposed' state`);
    }
    await audit({
      actor: sponsor,
      event: "superseded",
      draft_id: prev.draft_id,
      details: { superseded_by_version: prev.version + 1 },
      policy_citations: prev.policy_citations,
    });
    lineage_id = prev.lineage_id;
    version = prev.version + 1;
  }

  const draftRow: DraftRecord = {
    draft_id: randomUUID(),
    lineage_id,
    version,
    kind: "onboarding_ticket",
    payload,
    approval_chain: [],
    warnings,
    policy_citations,
    status: "proposed",
    conversation_id: input.conversation_id ?? null,
  };

  const saved = await store.insert(draftRow);
  await audit({
    actor: sponsor,
    event: "proposed",
    draft_id: saved.draft_id,
    details: {
      kind: "onboarding_ticket",
      version: saved.version,
      lineage_id: saved.lineage_id,
      contractor_name,
      vendor: payload.vendor ?? null,
      sponsor,
      start_date,
      end_date,
      restricted_access_expected,
      vendor_flag,
    },
    policy_citations,
  });

  return { status: "drafted", draft: saved, vendor_flag };
}
