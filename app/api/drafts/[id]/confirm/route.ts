import { NextResponse } from "next/server";
import { z } from "zod";
import { getDraft, type AccessRequestPayload } from "@/lib/drafts/drafts";
import type { ExecuteDraftResult, ExecuteOnboardingResult } from "@/lib/drafts/execute";
import { createConfirmClient } from "@/lib/mcp/client";
import type { ConfirmationEvent } from "@/lib/mcp/registry";
import { createMcpServer } from "@/lib/mcp/server";
import { writeTools } from "@/lib/mcp/tools/write";
import { recordApprovalDecision } from "@/lib/observability/langfuse";
import { getApprovalEngine } from "@/lib/workflow/in-memory";

export interface AccessRequestSubmittedEvent {
  type: "access_request.submitted";
  request_id: string;
  draft_id: string;
  request: AccessRequestPayload;
  approval_chain: { seq: number; role: string; approver_name: string | null }[];
  sla_business_days: number;
  emitted_at: string;
}

type SubmitHandler = (event: AccessRequestSubmittedEvent) => Promise<void> | void;
const submitHandlers = new Set<SubmitHandler>();

export function onAccessRequestSubmitted(handler: SubmitHandler): () => void {
  submitHandlers.add(handler);
  return () => submitHandlers.delete(handler);
}

async function emitSubmitted(event: AccessRequestSubmittedEvent): Promise<void> {
  for (const h of submitHandlers) {
    await h(event);
  }
}

const ConfirmBody = z.object({
  confirmed_by: z.string().trim().min(1).default("anonymous"),
});

/**
 * POST /api/drafts/{id}/confirm (T046, FR-010, FR-024, contracts/http-api.md).
 * Action confirmation: executes the simulated `create_access_request` MCP write tool once
 * per `draft_id`, re-checking policy against today's date first. Emits `access_request.submitted`
 * on first execution.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const raw = await req.json().catch(() => ({}));
  const parsed = ConfirmBody.safeParse(raw);
  const confirmed_by = parsed.success ? parsed.data.confirmed_by : "anonymous";

  const confirmation: ConfirmationEvent = {
    draft_id: id,
    confirmed_by,
    at: new Date().toISOString(),
  };

  const server = createMcpServer(writeTools());
  const client = await createConfirmClient(server, confirmation);
  try {
    const draftMeta = await getDraft(id).catch(() => null);
    if (draftMeta?.kind === "onboarding_ticket") {
      const toolRes = await client.call("create_onboarding_ticket", { draft_id: id });
      if (!toolRes.ok) {
        return NextResponse.json(toolRes.data, { status: 400 });
      }
      const res = toolRes.data as ExecuteOnboardingResult;
      if (res.status === "not_found") {
        return NextResponse.json(
          { error: { code: "not_found", message: `Draft ${id} not found` } },
          { status: 404 },
        );
      }
      if (res.status === "draft_not_submittable") {
        return NextResponse.json(
          {
            error: {
              code: "draft_not_submittable",
              message: `Draft ${id} has status '${res.draft_status}' and cannot be submitted`,
            },
          },
          { status: 409 },
        );
      }
      if (res.status === "confirmation_required") {
        return NextResponse.json(
          { error: { code: "confirmation_required", message: "Action confirmation required" } },
          { status: 403 },
        );
      }
      const decisionTrace = await recordApprovalDecision({
        type: "confirmation",
        draft_id: id,
        request_id: res.ticket_id,
        actor: confirmed_by,
        decision: "confirmed",
        sla_breached: false,
        at: confirmation.at,
      });
      return NextResponse.json({
        ticket_id: res.ticket_id,
        request_id: res.ticket_id,
        status: res.ticket_status,
        idempotent_replay: res.idempotent_replay,
        trace_id: decisionTrace.trace_id,
      });
    }

    const toolRes = await client.call("create_access_request", { draft_id: id });
    if (!toolRes.ok) {
      return NextResponse.json(toolRes.data, { status: 400 });
    }
    const res = toolRes.data as ExecuteDraftResult;

    if (res.status === "not_found") {
      return NextResponse.json(
        { error: { code: "not_found", message: `Draft ${id} not found` } },
        { status: 404 },
      );
    }
    if (res.status === "draft_not_submittable") {
      return NextResponse.json(
        {
          error: {
            code: "draft_not_submittable",
            message: `Draft ${id} has status '${res.draft_status}' and cannot be submitted`,
          },
        },
        { status: 409 },
      );
    }
    if (res.status === "policy_check_failed") {
      return NextResponse.json(
        {
          error: {
            code: "policy_check_failed",
            message: "Policy re-check failed at confirmation time",
            breaches: res.breaches,
          },
          breaches: res.breaches,
        },
        { status: 409 },
      );
    }
    if (res.status === "confirmation_required") {
      return NextResponse.json(
        { error: { code: "confirmation_required", message: "Action confirmation required" } },
        { status: 403 },
      );
    }

    const event: AccessRequestSubmittedEvent = {
      type: "access_request.submitted",
      request_id: res.request_id,
      draft_id: id,
      request: res.payload,
      approval_chain: res.approval_chain.map((s) => ({
        seq: s.seq,
        role: s.role === "line_manager" ? "sponsor" : s.role,
        approver_name: s.approver_name,
      })),
      sla_business_days: res.sla_business_days,
      emitted_at: new Date().toISOString(),
    };

    if (!res.idempotent_replay) {
      await getApprovalEngine().start(event);
      await emitSubmitted(event);
    }

    const decisionTrace = await recordApprovalDecision({
      type: "confirmation",
      draft_id: id,
      request_id: res.request_id,
      actor: confirmed_by,
      decision: "confirmed",
      sla_breached: false,
      at: confirmation.at,
    });

    return NextResponse.json({
      request_id: res.request_id,
      status: res.request_status,
      approval_chain: event.approval_chain,
      sla_business_days: res.sla_business_days,
      idempotent_replay: res.idempotent_replay,
      event,
      trace_id: decisionTrace.trace_id,
    });
  } finally {
    await client.close();
  }
}
