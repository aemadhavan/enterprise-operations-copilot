import { NextResponse } from "next/server";
import { getApprovalEngine } from "@/lib/workflow/in-memory";

/**
 * GET /api/requests/{request_id} (T049, FR-024, contracts/http-api.md).
 * Returns `{ request_id, status, sla_business_days, steps, events }` to drive the status timeline.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const timeline = await getApprovalEngine().status(id);
  if (!timeline) {
    return NextResponse.json(
      { error: { code: "not_found", message: `Request ${id} not found` } },
      { status: 404 },
    );
  }
  return NextResponse.json(timeline);
}
