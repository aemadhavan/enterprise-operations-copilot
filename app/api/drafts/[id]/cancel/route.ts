import { NextResponse } from "next/server";
import { cancelDraft } from "@/lib/drafts/drafts";

/**
 * POST /api/drafts/{id}/cancel (T046, contracts/http-api.md).
 * Transitions `proposed` → `cancelled` and writes a `cancelled` audit row; any other state → 409.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { actor?: string };
  const actor = typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "anonymous";

  const res = await cancelDraft(id, actor);
  if (!res.ok) {
    if (res.code === "not_found") {
      return NextResponse.json(
        { error: { code: "not_found", message: `Draft ${id} not found` } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "draft_not_submittable",
          message: `Draft ${id} cannot be cancelled from status '${res.draft?.status ?? "unknown"}'`,
        },
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    draft_id: id,
    status: "cancelled",
  });
}
