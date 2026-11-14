import "../../scripts/_env";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { POST as cancelRoute } from "@/app/api/drafts/[id]/cancel/route";
import { POST as confirmRoute } from "@/app/api/drafts/[id]/confirm/route";
import { closePool, sql } from "@/lib/db/client";
import { createDraft } from "@/lib/drafts/drafts";

const enabled = Boolean(process.env.DATABASE_URL);

function confirmReq(id: string, confirmed_by = "Tom Gallagher") {
  return confirmRoute(
    new Request(`http://localhost:3000/api/drafts/${id}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed_by }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function cancelReq(id: string) {
  return cancelRoute(
    new Request(`http://localhost:3000/api/drafts/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "Tom Gallagher" }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const baseDraftInput = {
  requester_name: "Alex Chen",
  requester_type: "Contractor" as const,
  sponsor: "Tom Gallagher",
  system_id: "SYS-CRM",
  access_level: "read" as const,
  duration_days: 60,
  justification: "Customer-churn analysis",
};

describe.skipIf(!enabled)("confirm idempotency & policy re-check (T039, FR-010, clarification 4)", () => {
  afterAll(closePool);

  it("confirm executes once with pending_approvals and proposed+confirmed+executed audit; second confirm is an idempotent replay", async () => {
    const drafted = await createDraft(baseDraftInput);
    expect(drafted.status).toBe("drafted");
    if (drafted.status !== "drafted") return;
    const draftId = drafted.draft.draft_id;

    const res1 = await confirmReq(draftId);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as {
      request_id: string;
      status: string;
      idempotent_replay: boolean;
    };
    expect(body1.request_id).toMatch(/^AR-\d{4,}$/);
    expect(body1.status).toBe("pending_approvals");
    expect(body1.idempotent_replay).toBe(false);

    const res2 = await confirmReq(draftId);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      request_id: string;
      status: string;
      idempotent_replay: boolean;
    };
    expect(body2.request_id).toBe(body1.request_id);
    expect(body2.status).toBe("pending_approvals");
    expect(body2.idempotent_replay).toBe(true);

    const rows = (await sql`
      SELECT request_id FROM access_requests WHERE draft_id = ${draftId}::uuid
    `) as { request_id: string }[];
    expect(rows).toHaveLength(1);

    const audits = (await sql`
      SELECT event FROM audit_log WHERE draft_id = ${draftId}::uuid ORDER BY id
    `) as { event: string }[];
    expect(audits.map((a) => a.event)).toEqual(["proposed", "confirmed", "executed"]);
  });

  it("concurrent double confirm yields exactly one access_requests row (DB unique draft_id)", async () => {
    const drafted = await createDraft(baseDraftInput);
    expect(drafted.status).toBe("drafted");
    if (drafted.status !== "drafted") return;
    const draftId = drafted.draft.draft_id;

    const [r1, r2] = await Promise.all([confirmReq(draftId), confirmReq(draftId)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = (await r1.json()) as { request_id: string; idempotent_replay: boolean };
    const b2 = (await r2.json()) as { request_id: string; idempotent_replay: boolean };
    expect(b1.request_id).toBe(b2.request_id);
    expect([b1.idempotent_replay, b2.idempotent_replay].sort()).toEqual([false, true]);

    const rows = (await sql`
      SELECT count(*)::int AS n FROM access_requests WHERE draft_id = ${draftId}::uuid
    `) as { n: number }[];
    expect(rows[0].n).toBe(1);
  });

  it("rejects confirming a superseded or cancelled draft with 409 draft_not_submittable", async () => {
    // 1. Superseded draft
    const v1 = await createDraft(baseDraftInput);
    expect(v1.status).toBe("drafted");
    if (v1.status !== "drafted") return;

    const v2 = await createDraft({
      ...baseDraftInput,
      duration_days: 30,
      supersedes_draft_id: v1.draft.draft_id,
    });
    expect(v2.status).toBe("drafted");

    const supRes = await confirmReq(v1.draft.draft_id);
    expect(supRes.status).toBe(409);
    const supBody = (await supRes.json()) as { error: { code: string } };
    expect(supBody.error.code).toBe("draft_not_submittable");

    // 2. Cancelled draft
    const toCancel = await createDraft(baseDraftInput);
    expect(toCancel.status).toBe("drafted");
    if (toCancel.status !== "drafted") return;

    const cRes = await cancelReq(toCancel.draft.draft_id);
    expect(cRes.status).toBe(200);

    const canRes = await confirmReq(toCancel.draft.draft_id);
    expect(canRes.status).toBe(409);
    const canBody = (await canRes.json()) as { error: { code: string } };
    expect(canBody.error.code).toBe("draft_not_submittable");
  });

  it("blocks confirm with 409 policy_check_failed and audit blocked when policy check now fails (vendor assessment expired since drafting)", async () => {
    const staleDraftId = randomUUID();
    const lineageId = randomUUID();
    const stalePayload = {
      ...baseDraftInput,
      vendor: "Quillon Data Services", // expired 2026-09-30 vs today 2026-11-13 (VND-002)
    };

    // Simulate a draft created before Quillon's assessment expired, still in 'proposed' status.
    await sql`
      INSERT INTO drafts (
        draft_id, lineage_id, version, kind, payload, approval_chain, warnings, policy_citations, status
      ) VALUES (
        ${staleDraftId}::uuid,
        ${lineageId}::uuid,
        1,
        'access_request',
        ${JSON.stringify(stalePayload)}::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        ARRAY['POL-022', 'VND-002'],
        'proposed'
      )
    `;

    const res = await confirmReq(staleDraftId);
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; breaches?: unknown[] };
      breaches?: unknown[];
    };
    expect(body.error.code).toBe("policy_check_failed");
    const breaches = body.breaches ?? body.error.breaches ?? [];
    expect(Array.isArray(breaches) && breaches.length > 0).toBe(true);

    const reqRows = (await sql`
      SELECT request_id FROM access_requests WHERE draft_id = ${staleDraftId}::uuid
    `) as { request_id: string }[];
    expect(reqRows).toHaveLength(0);

    const audits = (await sql`
      SELECT event FROM audit_log WHERE draft_id = ${staleDraftId}::uuid ORDER BY id
    `) as { event: string }[];
    expect(audits.map((a) => a.event)).toContain("blocked");
    expect(audits.map((a) => a.event)).not.toContain("executed");
  });
});
