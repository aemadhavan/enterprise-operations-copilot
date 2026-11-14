import { NextResponse } from "next/server";
import { z } from "zod";
import { getApprovalEngine } from "@/lib/workflow/in-memory";

const SimulatedApproverBody = z.object({
  request_id: z.string().trim().min(1),
  role: z.string().trim().min(1),
  decision: z.enum(["approve", "reject"]),
  actor: z.string().trim().optional(),
});

function isSameOrigin(req: Request): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  const expectedHost = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase();
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * POST /api/simulated-approver (T049, FR-024a, contracts/http-api.md).
 * Guarded UI-only route that resumes an organisational approval hook (`${request_id}:${role}`).
 * - Rejects requests carrying any agent context marker (`x-agent-context`, `x-mcp-caller: agent`) with 403.
 * - Requires `x-approver-panel: 1` and a same-origin check (403 otherwise).
 * - Never reachable from any MCP tool.
 */
export async function POST(req: Request): Promise<Response> {
  if (
    req.headers.get("x-agent-context") ||
    req.headers.get("x-mcp-caller")?.toLowerCase() === "agent"
  ) {
    return NextResponse.json(
      {
        error: {
          code: "agent_context_forbidden",
          message: "Agent context cannot resume organisational approval hooks (FR-024a)",
        },
      },
      { status: 403 },
    );
  }

  if (req.headers.get("x-approver-panel") !== "1") {
    return NextResponse.json(
      {
        error: {
          code: "panel_header_required",
          message: "Simulated approver panel header (x-approver-panel: 1) is required (FR-024a)",
        },
      },
      { status: 403 },
    );
  }

  if (!isSameOrigin(req)) {
    return NextResponse.json(
      {
        error: {
          code: "cross_origin_forbidden",
          message: "Cross-origin requests to /api/simulated-approver are forbidden",
        },
      },
      { status: 403 },
    );
  }

  const raw = await req.json().catch(() => null);
  const parsed = SimulatedApproverBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_input", message: parsed.error.message } },
      { status: 400 },
    );
  }

  try {
    const timeline = await getApprovalEngine().resume(parsed.data);
    return NextResponse.json(timeline);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /Unknown request_id/i.test(message) ? 404 : 400;
    return NextResponse.json(
      { error: { code: status === 404 ? "not_found" : "resume_failed", message } },
      { status },
    );
  }
}
