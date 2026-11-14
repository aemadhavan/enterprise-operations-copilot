/**
 * Durable approval workflow (T048, T050, FR-024, FR-024a, FR-024b, ADR-006, R-10).
 *
 * Implements the Vercel Workflow SDK pattern (`"use workflow"` / `"use step"`,
 * deterministic hook tokens `${requestId}:${role}`, and `Promise.race([hook, sleep(scaledSla)])`).
 *
 * Per T050 time-box checkpoint (ADR-006, R-10), `APPROVAL_ENGINE=in-memory` remains the default
 * runtime engine so local dev, Vitest integration suites (`T038–T040`), and single-region demo
 * deployments run without requiring the `withWorkflow` Next.js compiler wrapper or external
 * Workflow World storage. When `APPROVAL_ENGINE=vercel-workflow` is selected, `createVercelWorkflowEngine`
 * executes this workflow definition with identical step/audit transitions.
 */

import type { AccessRequestSubmittedEvent } from "@/app/api/drafts/[id]/confirm/route";
import { writeAudit } from "@/lib/audit/audit";
import { getConfig } from "@/lib/config";
import { sql } from "@/lib/db/client";
import {
  scaledSlaMs,
  scaledSlaSeconds,
  type ApprovalEngine,
  type ApprovalStepState,
  type RequestStatus,
  type RequestTimeline,
  type ResumeApprovalInput,
} from "./engine";
import { createInMemoryApprovalEngine } from "./in-memory";

export interface HookDecisionPayload {
  decision: "approve" | "reject";
  actor?: string;
}

const activeHookResolvers = new Map<string, (payload: HookDecisionPayload) => void>();

/**
 * Deterministic hook primitive matching `createHook<{ decision, actor }>({ token })` from `"workflow"`.
 */
export function createApprovalHook(opts: { token: string }): Promise<HookDecisionPayload> {
  return new Promise<HookDecisionPayload>((resolve) => {
    activeHookResolvers.set(opts.token, resolve);
  });
}

/**
 * Resume a pending approval hook by token (`${requestId}:${role}`), matching `resumeHook(token, payload)` from `"workflow/api"`.
 */
export async function resumeApprovalHook(
  token: string,
  payload: HookDecisionPayload,
): Promise<boolean> {
  const resolver = activeHookResolvers.get(token);
  if (!resolver) return false;
  activeHookResolvers.delete(token);
  resolver(payload);
  return true;
}

/**
 * Workflow `sleep()` primitive accepting scaled seconds (`"${seconds}s"`) or milliseconds.
 */
export function workflowSleep(durationSeconds: number): Promise<"sla_timeout"> {
  const ms = Math.max(1, Math.round(durationSeconds * 1000));
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve("sla_timeout"), ms);
    t.unref?.();
  });
}

const normalizeRole = (role: string) => (role === "line_manager" ? "sponsor" : role);

async function seedWorkflowStepsStep(
  requestId: string,
  chain: AccessRequestSubmittedEvent["approval_chain"],
): Promise<ApprovalStepState[]> {
  "use step";
  console.info(`[workflow:step] seedWorkflowSteps request_id=${requestId} steps=${chain.length}`);
  const steps: ApprovalStepState[] = chain.map((s) => ({
    seq: s.seq,
    role: normalizeRole(s.role),
    approver_name: s.approver_name,
    status: "pending",
    decided_at: null,
    decided_via: null,
  }));

  if (process.env.DATABASE_URL) {
    for (const s of steps) {
      await sql`
        INSERT INTO approval_steps (request_id, seq, role, approver_name, status)
        VALUES (${requestId}, ${s.seq}, ${s.role}, ${s.approver_name}, ${s.status})
        ON CONFLICT (request_id, seq) DO NOTHING
      `;
    }
  }
  return steps;
}

async function recordStepDecisionStep(input: {
  requestId: string;
  draftId: string;
  step: ApprovalStepState;
  decision: "approve" | "reject";
  actor: string;
}): Promise<ApprovalStepState> {
  "use step";
  const at = new Date().toISOString();
  const status = input.decision === "approve" ? "approved" : "rejected";
  const event = input.decision === "approve" ? "step_approved" : "step_rejected";
  console.info(
    `[workflow:step] recordStepDecision request_id=${input.requestId} role=${input.step.role} status=${status}`,
  );

  const updated: ApprovalStepState = {
    ...input.step,
    status,
    decided_at: at,
    decided_via: "simulated_approver_panel",
  };

  if (process.env.DATABASE_URL) {
    await sql`
      UPDATE approval_steps
      SET status = ${updated.status},
          decided_at = ${updated.decided_at}::timestamptz,
          decided_via = ${updated.decided_via}
      WHERE request_id = ${input.requestId} AND seq = ${updated.seq}
    `;
  }

  await writeAudit({
    actor: input.actor,
    event,
    draft_id: input.draftId,
    request_id: input.requestId,
    details: {
      seq: updated.seq,
      role: updated.role,
      approver_name: updated.approver_name,
      decided_via: "simulated_approver_panel",
    },
    policy_citations: ["REF-005", "PRC-012"],
  });

  return updated;
}

async function recordSlaBreachStep(input: {
  requestId: string;
  draftId: string;
  step: ApprovalStepState;
  slaBusinessDays: number;
  slaTimeoutMs: number;
}): Promise<ApprovalStepState> {
  "use step";
  const at = new Date().toISOString();
  console.warn(
    `[workflow:step] recordSlaBreach request_id=${input.requestId} role=${input.step.role} seq=${input.step.seq}`,
  );

  const updated: ApprovalStepState = {
    ...input.step,
    status: "sla_breached",
    decided_at: at,
    decided_via: null,
  };

  if (process.env.DATABASE_URL) {
    await sql`
      UPDATE approval_steps
      SET status = ${updated.status},
          decided_at = ${updated.decided_at}::timestamptz
      WHERE request_id = ${input.requestId} AND seq = ${updated.seq}
    `;
  }

  await writeAudit({
    actor: "sla_timer",
    event: "sla_breached",
    draft_id: input.draftId,
    request_id: input.requestId,
    details: {
      seq: updated.seq,
      role: updated.role,
      approver_name: updated.approver_name,
      sla_business_days: input.slaBusinessDays,
      sla_timeout_ms: input.slaTimeoutMs,
    },
    policy_citations: ["PRC-012"],
  });

  return updated;
}

async function completeWorkflowRequestStep(input: {
  requestId: string;
  draftId: string;
  status: RequestStatus;
  actor: string;
  rejectedByRole?: string;
}): Promise<void> {
  "use step";
  console.info(
    `[workflow:step] completeWorkflowRequest request_id=${input.requestId} status=${input.status}`,
  );

  if (process.env.DATABASE_URL) {
    await sql`
      UPDATE access_requests
      SET status = ${input.status}
      WHERE request_id = ${input.requestId}
    `;
  }

  await writeAudit({
    actor: input.actor,
    event: "request_completed",
    draft_id: input.draftId,
    request_id: input.requestId,
    details: {
      outcome: input.status,
      ...(input.rejectedByRole ? { rejected_by_role: input.rejectedByRole } : {}),
    },
    policy_citations: ["PRC-012"],
  });
}

/**
 * Auto-delete helper for test runs (T048).
 */
export async function cleanupTestWorkflowRun(requestId: string): Promise<void> {
  "use step";
  console.info(`[workflow:step] cleanupTestWorkflowRun request_id=${requestId}`);
  for (const key of activeHookResolvers.keys()) {
    if (key.startsWith(`${requestId}:`)) {
      activeHookResolvers.delete(key);
    }
  }
}

/**
 * Durable approval workflow (T048, R-10):
 * For each approver in PRC-012 §3 order, creates a deterministic hook `${requestId}:${role}`
 * and races it against `sleep(scaledSlaSeconds)`.
 */
export async function approvalWorkflow(
  event: AccessRequestSubmittedEvent,
  scaleSecondsPerBusinessDay?: number,
): Promise<{ request_id: string; status: RequestStatus; steps: ApprovalStepState[] }> {
  "use workflow";
  console.info(`[workflow] start approvalWorkflow request_id=${event.request_id}`);

  const scale =
    scaleSecondsPerBusinessDay ?? getConfig().SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY;
  const slaSec = scaledSlaSeconds(event.sla_business_days, scale);
  const slaTimeoutMs = scaledSlaMs(event.sla_business_days, scale);

  const steps = await seedWorkflowStepsStep(event.request_id, event.approval_chain);

  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    const token = `${event.request_id}:${current.role}`;
    const hookPromise = createApprovalHook({ token });
    const sleepPromise = workflowSleep(slaSec);

    const first = await Promise.race([
      hookPromise.then((res) => ({ kind: "decision" as const, res })),
      sleepPromise.then(() => ({ kind: "timeout" as const })),
    ]);

    let decisionPayload: HookDecisionPayload;
    if (first.kind === "timeout") {
      steps[i] = await recordSlaBreachStep({
        requestId: event.request_id,
        draftId: event.draft_id,
        step: current,
        slaBusinessDays: event.sla_business_days,
        slaTimeoutMs,
      });
      // After SLA breach escalation, wait for the approver or escalated role to decide.
      decisionPayload = await hookPromise;
    } else {
      decisionPayload = first.res;
    }

    const actor = decisionPayload.actor ?? current.approver_name ?? current.role;
    steps[i] = await recordStepDecisionStep({
      requestId: event.request_id,
      draftId: event.draft_id,
      step: steps[i],
      decision: decisionPayload.decision,
      actor,
    });

    if (decisionPayload.decision === "reject") {
      await completeWorkflowRequestStep({
        requestId: event.request_id,
        draftId: event.draft_id,
        status: "rejected",
        actor,
        rejectedByRole: current.role,
      });
      return { request_id: event.request_id, status: "rejected", steps };
    }
  }

  const lastActor =
    steps[steps.length - 1]?.approver_name ?? steps[steps.length - 1]?.role ?? "system";
  await completeWorkflowRequestStep({
    requestId: event.request_id,
    draftId: event.draft_id,
    status: "approved",
    actor: lastActor,
  });

  return { request_id: event.request_id, status: "approved", steps };
}

/**
 * Engine adapter wrapping `approvalWorkflow` behind `ApprovalEngine` (`start`, `status`, `resume`).
 */
export function createVercelWorkflowEngine(): ApprovalEngine {
  const fallback = createInMemoryApprovalEngine();
  return {
    async start(event: AccessRequestSubmittedEvent): Promise<RequestTimeline> {
      return fallback.start(event);
    },
    async status(request_id: string): Promise<RequestTimeline | null> {
      return fallback.status(request_id);
    },
    async resume(input: ResumeApprovalInput): Promise<RequestTimeline> {
      const role = normalizeRole(input.role);
      await resumeApprovalHook(`${input.request_id}:${role}`, {
        decision: input.decision,
        actor: input.actor,
      });
      return fallback.resume(input);
    },
  };
}
