import { beforeAll, describe, expect, it } from "vitest";
import type { WriteAuditInput } from "@/lib/audit/audit";
import {
  cancelDraft,
  createDraft,
  type DraftRecord,
  type DraftStore,
} from "@/lib/drafts/drafts";
import { readGraphSeed } from "@/lib/graph/load";
import type { Graph } from "@/lib/policy/approvals";

let graph: Graph;
beforeAll(async () => {
  graph = await readGraphSeed();
});

function makeMemoryDeps() {
  const rows = new Map<string, DraftRecord>();
  const audits: WriteAuditInput[] = [];
  const store: DraftStore = {
    async getById(id) {
      return rows.get(id) ?? null;
    },
    async insert(row) {
      rows.set(row.draft_id, { ...row });
      return rows.get(row.draft_id)!;
    },
    async updateStatus(id, from, to) {
      const cur = rows.get(id);
      if (!cur || cur.status !== from) return false;
      rows.set(id, { ...cur, status: to });
      return true;
    },
  };
  return {
    rows,
    audits,
    deps: {
      graph: async () => graph,
      audit: async (e: WriteAuditInput) => {
        audits.push(e);
      },
      store,
    },
  };
}

describe("immutable drafts (T043, FR-009, FR-011, FR-023)", () => {
  it("runs policy check BEFORE missing fields: 120-day request without sponsor/justification returns blocked + audit blocked (GS-023)", async () => {
    const { rows, audits, deps } = makeMemoryDeps();
    const res = await createDraft(
      {
        requester_name: "Alex Chen",
        requester_type: "Contractor",
        system_id: "SYS-CRM",
        access_level: "read",
        duration_days: 120,
      },
      deps,
    );
    expect(res.status).toBe("blocked");
    if (res.status !== "blocked") return;
    expect(res.breaches[0].rule).toBe("contractor_duration_max");
    expect(res.missing).toEqual(["sponsor", "justification"]);
    expect(rows.size).toBe(0);
    expect(audits.map((a) => a.event)).toEqual(["blocked"]);
  });

  it("returns needs_fields without creating a draft when compliant but missing required fields", async () => {
    const { rows, audits, deps } = makeMemoryDeps();
    const res = await createDraft(
      {
        requester_name: "Alex Chen",
        requester_type: "Contractor",
        system_id: "SYS-CRM",
        access_level: "read",
        duration_days: 60,
      },
      deps,
    );
    expect(res).toEqual({
      status: "needs_fields",
      missing: ["sponsor", "justification"],
    });
    expect(rows.size).toBe(0);
    expect(audits).toHaveLength(0);
  });

  it("creates version 1 with approval chain, separation-of-duties warning, and proposed audit (GS-022)", async () => {
    const { rows, audits, deps } = makeMemoryDeps();
    const res = await createDraft(
      {
        requester_name: "Alex Chen",
        requester_type: "Contractor",
        sponsor: "Tom Gallagher",
        system_id: "SYS-CRM",
        access_level: "read",
        duration_days: 60,
        justification: "Customer-churn analysis",
      },
      deps,
    );
    expect(res.status).toBe("drafted");
    if (res.status !== "drafted") return;
    expect(res.draft.version).toBe(1);
    expect(res.draft.status).toBe("proposed");
    expect(res.draft.approval_chain.map((s) => s.role)).toEqual([
      "sponsor",
      "data_owner",
      "security_governance",
      "privacy_officer",
    ]);
    expect(res.draft.warnings.map((w) => w.code)).toContain("separation_of_duties");
    expect(rows.size).toBe(1);
    expect(audits.map((a) => a.event)).toEqual(["proposed"]);
  });

  it("supersedes an existing proposed draft into version 2 with shared lineage_id and marks v1 superseded", async () => {
    const { rows, audits, deps } = makeMemoryDeps();
    const v1 = await createDraft(
      {
        requester_name: "Alex Chen",
        requester_type: "Contractor",
        sponsor: "Tom Gallagher",
        system_id: "SYS-CRM",
        access_level: "read",
        duration_days: 60,
        justification: "Customer-churn analysis",
      },
      deps,
    );
    if (v1.status !== "drafted") throw new Error("expected v1 drafted");

    const v2 = await createDraft(
      {
        requester_name: "Alex Chen",
        requester_type: "Contractor",
        sponsor: "Tom Gallagher",
        system_id: "SYS-CRM",
        access_level: "read",
        duration_days: 90,
        justification: "Extended churn validation",
        supersedes_draft_id: v1.draft.draft_id,
      },
      deps,
    );
    expect(v2.status).toBe("drafted");
    if (v2.status !== "drafted") return;

    expect(v2.draft.lineage_id).toBe(v1.draft.lineage_id);
    expect(v2.draft.version).toBe(2);
    expect(rows.get(v1.draft.draft_id)?.status).toBe("superseded");
    expect(rows.get(v2.draft.draft_id)?.status).toBe("proposed");
    expect(audits.map((a) => a.event)).toEqual(["proposed", "superseded", "proposed"]);
  });

  it("cancels a proposed draft once and rejects cancelling a non-proposed draft", async () => {
    const { deps, audits } = makeMemoryDeps();
    const v1 = await createDraft(
      {
        requester_name: "Alex Chen",
        requester_type: "Contractor",
        sponsor: "Tom Gallagher",
        system_id: "SYS-CRM",
        access_level: "read",
        duration_days: 60,
        justification: "Customer-churn analysis",
      },
      deps,
    );
    if (v1.status !== "drafted") throw new Error("expected drafted");

    const first = await cancelDraft(v1.draft.draft_id, "Tom Gallagher", deps);
    expect(first.ok).toBe(true);
    expect(first.draft?.status).toBe("cancelled");

    const second = await cancelDraft(v1.draft.draft_id, "Tom Gallagher", deps);
    expect(second).toMatchObject({ ok: false, code: "draft_not_submittable" });
    expect(audits.map((a) => a.event)).toEqual(["proposed", "cancelled"]);
  });
});
