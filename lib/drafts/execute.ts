import { writeAudit, type WriteAuditInput } from "@/lib/audit/audit";
import { sql } from "@/lib/db/client";
import {
  getDraft,
  type AccessRequestPayload,
  type DraftApprovalStep,
  type DraftRecord,
} from "@/lib/drafts/drafts";
import type { ConfirmationEvent } from "@/lib/mcp/registry";
import { checkPolicy, type PolicyBreach } from "@/lib/policy/checks";

export type ExecuteDraftResult =
  | {
      status: "executed";
      request_id: string;
      request_status: "pending_approvals" | "approved" | "rejected" | "expired";
      approval_chain: DraftApprovalStep[];
      sla_business_days: number;
      idempotent_replay: boolean;
      payload: AccessRequestPayload;
    }
  | { status: "not_found" }
  | { status: "draft_not_submittable"; draft_status: string }
  | { status: "policy_check_failed"; breaches: PolicyBreach[] }
  | { status: "confirmation_required" };

const RESTRICTED_SYSTEMS = new Set(["SYS-CRM", "SYS-DWH", "SYS-BILL", "SYS-HR", "SYS-IAM"]);

export function slaBusinessDaysFor(system_id: string): 2 | 5 {
  return RESTRICTED_SYSTEMS.has(system_id) ? 5 : 2;
}

export interface ExecuteDeps {
  loadDraft?: (draft_id: string) => Promise<DraftRecord | null>;
  audit?: (entry: WriteAuditInput) => Promise<unknown>;
}

/**
 * Idempotent confirmation execution for access-request drafts (T045, FR-010, FR-011, Constitution II):
 * 1. Requires a matching `ConfirmationEvent` in context.
 * 2. Rejects `superseded` / `cancelled` drafts with `draft_not_submittable`.
 * 3. Re-runs `checkPolicy` against today's date (`2026-11-13`) before executing; if it now fails,
 *    writes a `blocked` audit row and refuses with `policy_check_failed`.
 * 4. Inserts into `access_requests` with `ON CONFLICT (draft_id) DO NOTHING` and reads back on conflict
 *    so concurrent double-confirm produces a single row and a single `confirmed` + `executed` audit pair.
 */
export async function executeAccessRequest(
  draft_id: string,
  confirmation: ConfirmationEvent | undefined,
  deps: ExecuteDeps = {},
): Promise<ExecuteDraftResult> {
  if (
    !confirmation ||
    confirmation.draft_id !== draft_id ||
    !confirmation.confirmed_by?.trim()
  ) {
    return { status: "confirmation_required" };
  }

  const load = deps.loadDraft ?? ((id) => getDraft(id));
  const audit = deps.audit ?? writeAudit;

  const draft = await load(draft_id);
  if (!draft) return { status: "not_found" };

  if (draft.status === "superseded" || draft.status === "cancelled") {
    return { status: "draft_not_submittable", draft_status: draft.status };
  }

  if (draft.status === "confirmed") {
    const existing = (await sql`
      SELECT request_id, status, sla_business_days
      FROM access_requests
      WHERE draft_id = ${draft_id}::uuid
    `) as {
      request_id: string;
      status: "pending_approvals" | "approved" | "rejected" | "expired";
      sla_business_days: number;
    }[];
    if (existing[0]) {
      return {
        status: "executed",
        request_id: existing[0].request_id,
        request_status: existing[0].status,
        approval_chain: draft.approval_chain,
        sla_business_days: existing[0].sla_business_days,
        idempotent_replay: true,
        payload: draft.payload,
      };
    }
  }

  // Re-run policy check at confirmation time against today's date (Constitution II, T039).
  const recheck = checkPolicy({
    system_id: draft.payload.system_id,
    requester_type: draft.payload.requester_type,
    access_level: draft.payload.access_level,
    duration_days: draft.payload.duration_days,
    vendor: draft.payload.vendor,
  });

  if (!recheck.ok) {
    await audit({
      actor: confirmation.confirmed_by,
      event: "blocked",
      draft_id,
      details: {
        stage: "confirm_recheck",
        breaches: recheck.breaches,
      },
      policy_citations: recheck.citations.length ? recheck.citations : draft.policy_citations,
    });
    return { status: "policy_check_failed", breaches: recheck.breaches };
  }

  const sla_business_days = slaBusinessDaysFor(draft.payload.system_id);

  const inserted = (await sql`
    INSERT INTO access_requests (
      draft_id, payload, sla_business_days, status, confirmed_by
    ) VALUES (
      ${draft_id}::uuid,
      ${JSON.stringify(draft.payload)}::jsonb,
      ${sla_business_days},
      'pending_approvals',
      ${confirmation.confirmed_by.trim()}
    )
    ON CONFLICT (draft_id) DO NOTHING
    RETURNING request_id, status, sla_business_days
  `) as {
    request_id: string;
    status: "pending_approvals" | "approved" | "rejected" | "expired";
    sla_business_days: number;
  }[];

  if (inserted.length === 1) {
    await sql`
      UPDATE drafts
      SET status = 'confirmed'
      WHERE draft_id = ${draft_id}::uuid AND status = 'proposed'
    `;
    await audit({
      actor: confirmation.confirmed_by,
      event: "confirmed",
      draft_id,
      request_id: inserted[0].request_id,
      details: { confirmed_at: confirmation.at },
      policy_citations: draft.policy_citations,
    });
    await audit({
      actor: confirmation.confirmed_by,
      event: "executed",
      draft_id,
      request_id: inserted[0].request_id,
      details: {
        tool: "create_access_request",
        simulated: true,
        sla_business_days,
      },
      policy_citations: draft.policy_citations,
    });

    return {
      status: "executed",
      request_id: inserted[0].request_id,
      request_status: inserted[0].status,
      approval_chain: draft.approval_chain,
      sla_business_days: inserted[0].sla_business_days,
      idempotent_replay: false,
      payload: draft.payload,
    };
  }

  // Concurrent confirm won the race: read back the single row.
  const existing = (await sql`
    SELECT request_id, status, sla_business_days
    FROM access_requests
    WHERE draft_id = ${draft_id}::uuid
  `) as {
    request_id: string;
    status: "pending_approvals" | "approved" | "rejected" | "expired";
    sla_business_days: number;
  }[];

  return {
    status: "executed",
    request_id: existing[0].request_id,
    request_status: existing[0].status,
    approval_chain: draft.approval_chain,
    sla_business_days: existing[0].sla_business_days,
    idempotent_replay: true,
    payload: draft.payload,
  };
}
