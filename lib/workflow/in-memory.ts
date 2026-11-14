import type { AccessRequestSubmittedEvent } from "@/app/api/drafts/[id]/confirm/route";
import { writeAudit, type WriteAuditInput } from "@/lib/audit/audit";
import { getConfig } from "@/lib/config";
import { sql } from "@/lib/db/client";
import {
  scaledSlaMs,
  type ApprovalEngine,
  type ApprovalStepState,
  type RequestStatus,
  type RequestTimeline,
  type ResumeApprovalInput,
  type StepStatus,
} from "./engine";

export interface InMemoryEngineDeps {
  scaleSecondsPerBusinessDay?: number;
  audit?: (entry: WriteAuditInput) => Promise<unknown>;
  persist?: boolean;
}

interface InternalRun {
  timeline: RequestTimeline;
  timer?: ReturnType<typeof setTimeout>;
}

const normalizeRole = (role: string) => (role === "line_manager" ? "sponsor" : role);

async function persistInitialSteps(
  request_id: string,
  steps: ApprovalStepState[],
): Promise<void> {
  for (const s of steps) {
    await sql`
      INSERT INTO approval_steps (request_id, seq, role, approver_name, status)
      VALUES (${request_id}, ${s.seq}, ${s.role}, ${s.approver_name}, ${s.status})
      ON CONFLICT (request_id, seq) DO NOTHING
    `;
  }
}

async function persistStepUpdate(
  request_id: string,
  step: ApprovalStepState,
): Promise<void> {
  await sql`
    UPDATE approval_steps
    SET status = ${step.status},
        decided_at = ${step.decided_at}::timestamptz,
        decided_via = ${step.decided_via}
    WHERE request_id = ${request_id} AND seq = ${step.seq}
  `;
}

async function persistRequestStatus(
  request_id: string,
  status: RequestStatus,
): Promise<void> {
  await sql`
    UPDATE access_requests
    SET status = ${status}
    WHERE request_id = ${request_id}
  `;
}

async function loadTimelineFromDb(
  request_id: string,
  scaleSeconds?: number,
): Promise<RequestTimeline | null> {
  const reqRows = (await sql`
    SELECT r.request_id, r.draft_id::text AS draft_id, r.status, r.sla_business_days, d.approval_chain
    FROM access_requests r
    JOIN drafts d USING (draft_id)
    WHERE r.request_id = ${request_id}
  `) as {
    request_id: string;
    draft_id: string;
    status: RequestStatus;
    sla_business_days: number;
    approval_chain: { seq: number; role: string; approver_name: string | null }[];
  }[];
  if (!reqRows[0]) return null;
  const req = reqRows[0];

  let stepRows = (await sql`
    SELECT seq::int AS seq, role, approver_name, status,
           decided_at::text AS decided_at, decided_via
    FROM approval_steps
    WHERE request_id = ${request_id}
    ORDER BY seq
  `) as ApprovalStepState[];

  if (stepRows.length === 0 && Array.isArray(req.approval_chain) && req.approval_chain.length > 0) {
    const seeded: ApprovalStepState[] = req.approval_chain.map((s) => ({
      seq: s.seq,
      role: normalizeRole(s.role),
      approver_name: s.approver_name,
      status: "pending",
      decided_at: null,
      decided_via: null,
    }));
    await persistInitialSteps(request_id, seeded);
    stepRows = seeded;
  }

  const auditRows = (await sql`
    SELECT event, at::text AS at, actor, details
    FROM audit_log
    WHERE request_id = ${request_id} OR draft_id = ${req.draft_id}::uuid
    ORDER BY id
  `) as { event: string; at: string; actor: string; details: { role?: string; seq?: number } }[];

  return {
    request_id: req.request_id,
    draft_id: req.draft_id,
    status: req.status,
    sla_business_days: req.sla_business_days,
    sla_timeout_ms: scaledSlaMs(req.sla_business_days, scaleSeconds),
    steps: stepRows,
    events: auditRows.map((a) => ({
      event: a.event,
      at: a.at,
      actor: a.actor,
      ...(a.details?.role ? { role: a.details.role } : {}),
      ...(typeof a.details?.seq === "number" ? { seq: a.details.seq } : {}),
    })),
  };
}

/**
 * In-memory approval workflow state machine (T047, FR-024, FR-024b, ADR-006).
 * Races each pending approval against a scaled SLA timer (`sla_business_days * SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY` seconds)
 * and writes an append-only audit row on every transition (`step_approved`, `step_rejected`, `sla_breached`, `request_completed`).
 */
export function createInMemoryApprovalEngine(deps: InMemoryEngineDeps = {}): ApprovalEngine {
  const runs = new Map<string, InternalRun>();
  const audit = deps.audit ?? writeAudit;
  const persist = deps.persist ?? Boolean(process.env.DATABASE_URL);

  const clearTimer = (run: InternalRun) => {
    if (run.timer) {
      clearTimeout(run.timer);
      run.timer = undefined;
    }
  };

  const scheduleSlaTimer = (run: InternalRun) => {
    clearTimer(run);
    const { timeline } = run;
    if (timeline.status !== "pending_approvals") return;
    const nextPending = timeline.steps.find((s) => s.status === "pending");
    if (!nextPending) return;

    const timer = setTimeout(async () => {
      if (timeline.status !== "pending_approvals") return;
      const target = timeline.steps.find((s) => s.status === "pending");
      if (!target) return;

      const at = new Date().toISOString();
      target.status = "sla_breached";
      target.decided_at = at;
      timeline.events.push({
        event: "sla_breached",
        at,
        role: target.role,
        seq: target.seq,
        actor: "sla_timer",
      });

      try {
        if (persist) {
          await persistStepUpdate(timeline.request_id, target);
        }
        await audit({
          actor: "sla_timer",
          event: "sla_breached",
          draft_id: timeline.draft_id ?? null,
          request_id: timeline.request_id,
          details: {
            seq: target.seq,
            role: target.role,
            approver_name: target.approver_name,
            sla_business_days: timeline.sla_business_days,
            sla_timeout_ms: timeline.sla_timeout_ms,
          },
          policy_citations: ["PRC-012"],
        });
      } catch {
        // Keep in-memory state consistent even if background DB write fails after test teardown.
      }
    }, timeline.sla_timeout_ms);

    timer.unref?.();
    run.timer = timer;
  };

  return {
    async start(event: AccessRequestSubmittedEvent): Promise<RequestTimeline> {
      const existing = runs.get(event.request_id);
      if (existing) return structuredClone(existing.timeline);

      const scale =
        deps.scaleSecondsPerBusinessDay ?? getConfig().SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY;
      const sla_timeout_ms = scaledSlaMs(event.sla_business_days, scale);

      const steps: ApprovalStepState[] = event.approval_chain.map((s) => ({
        seq: s.seq,
        role: normalizeRole(s.role),
        approver_name: s.approver_name,
        status: "pending" as StepStatus,
        decided_at: null,
        decided_via: null,
      }));

      const timeline: RequestTimeline = {
        request_id: event.request_id,
        draft_id: event.draft_id,
        status: "pending_approvals",
        sla_business_days: event.sla_business_days,
        sla_timeout_ms,
        steps,
        events: [
          {
            event: "access_request.submitted",
            at: event.emitted_at,
          },
        ],
      };

      if (persist) {
        await persistInitialSteps(event.request_id, steps);
      }

      const run: InternalRun = { timeline };
      runs.set(event.request_id, run);
      scheduleSlaTimer(run);
      return structuredClone(timeline);
    },

    async status(request_id: string): Promise<RequestTimeline | null> {
      const mem = runs.get(request_id);
      if (mem) return structuredClone(mem.timeline);
      if (!persist) return null;
      const loaded = await loadTimelineFromDb(request_id, deps.scaleSecondsPerBusinessDay);
      if (loaded) {
        const run: InternalRun = { timeline: loaded };
        runs.set(request_id, run);
        return structuredClone(loaded);
      }
      return null;
    },

    async resume(input: ResumeApprovalInput): Promise<RequestTimeline> {
      let run = runs.get(input.request_id);
      if (!run && persist) {
        const loaded = await loadTimelineFromDb(input.request_id, deps.scaleSecondsPerBusinessDay);
        if (loaded) {
          run = { timeline: loaded };
          runs.set(input.request_id, run);
        }
      }
      if (!run) {
        throw new Error(`Unknown request_id ${input.request_id}`);
      }

      const { timeline } = run;
      const role = normalizeRole(input.role);
      const step =
        timeline.steps.find(
          (s) =>
            normalizeRole(s.role) === role &&
            (s.status === "pending" || s.status === "sla_breached"),
        ) ?? timeline.steps.find((s) => normalizeRole(s.role) === role);

      if (!step) {
        throw new Error(`No approval step for role '${input.role}' on ${input.request_id}`);
      }

      const at = new Date().toISOString();
      step.status = input.decision === "approve" ? "approved" : "rejected";
      step.decided_at = at;
      step.decided_via = "simulated_approver_panel";

      const auditEvent = input.decision === "approve" ? "step_approved" : "step_rejected";
      const actor = input.actor ?? step.approver_name ?? step.role;
      timeline.events.push({
        event: auditEvent,
        at,
        role: step.role,
        seq: step.seq,
        actor,
      });

      if (persist) {
        await persistStepUpdate(timeline.request_id, step);
      }

      await audit({
        actor,
        event: auditEvent,
        draft_id: timeline.draft_id ?? null,
        request_id: timeline.request_id,
        details: {
          seq: step.seq,
          role: step.role,
          approver_name: step.approver_name,
          decided_via: "simulated_approver_panel",
        },
        policy_citations: ["REF-005", "PRC-012"],
      });

      if (input.decision === "reject") {
        clearTimer(run);
        timeline.status = "rejected";
        timeline.events.push({ event: "request_completed", at, actor });
        if (persist) await persistRequestStatus(timeline.request_id, "rejected");
        await audit({
          actor,
          event: "request_completed",
          draft_id: timeline.draft_id ?? null,
          request_id: timeline.request_id,
          details: { outcome: "rejected", rejected_by_role: step.role },
          policy_citations: ["PRC-012"],
        });
      } else if (timeline.steps.every((s) => s.status === "approved")) {
        clearTimer(run);
        timeline.status = "approved";
        timeline.events.push({ event: "request_completed", at, actor });
        if (persist) await persistRequestStatus(timeline.request_id, "approved");
        await audit({
          actor,
          event: "request_completed",
          draft_id: timeline.draft_id ?? null,
          request_id: timeline.request_id,
          details: { outcome: "approved" },
          policy_citations: ["PRC-012"],
        });
      } else {
        scheduleSlaTimer(run);
      }

      return structuredClone(timeline);
    },
  };
}

let defaultEngine: ApprovalEngine | undefined;

export function getApprovalEngine(): ApprovalEngine {
  defaultEngine ??= createInMemoryApprovalEngine();
  return defaultEngine;
}
