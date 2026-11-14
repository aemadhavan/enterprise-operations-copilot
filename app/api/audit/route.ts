import { NextResponse } from "next/server";
import { listAudit, redactDetails, type AuditRow } from "@/lib/audit/audit";
import { redact } from "@/lib/observability/redact";

export interface AuditRouteDeps {
  list?: (opts: { limit?: number; draft_id?: string; request_id?: string }) => Promise<AuditRow[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/audit?limit=&draft_id=&request_id= (T058, FR-015, contracts/http-api.md).
 * Read-only list of append-only audit rows (PII-redacted).
 */
export async function handleAuditGet(
  req: Request,
  deps: AuditRouteDeps = {},
): Promise<Response> {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const draftIdParam = url.searchParams.get("draft_id")?.trim() || undefined;
  const requestIdParam = url.searchParams.get("request_id")?.trim() || undefined;

  let limit = 100;
  if (limitParam !== null && limitParam.trim() !== "") {
    const parsed = Number(limitParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "limit must be an integer between 1 and 500" } },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  if (draftIdParam && !UUID_RE.test(draftIdParam)) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "draft_id must be a valid UUID" } },
      { status: 400 },
    );
  }

  const list = deps.list ?? listAudit;
  try {
    const rawRows = await list({
      limit,
      draft_id: draftIdParam,
      request_id: requestIdParam,
    });
    const rows = rawRows.map((r) => ({
      ...r,
      actor: redact(r.actor),
      details: redactDetails(r.details),
    }));
    return NextResponse.json({ rows, count: rows.length });
  } catch (err) {
    const detail = err instanceof Error ? redact(err.message) : "Database unavailable";
    return NextResponse.json(
      {
        error: {
          code: "upstream_unavailable",
          message: `Audit store unavailable (${detail})`,
        },
      },
      { status: 503 },
    );
  }
}

export async function GET(req: Request): Promise<Response> {
  return handleAuditGet(req);
}
