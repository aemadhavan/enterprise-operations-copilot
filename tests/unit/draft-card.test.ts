import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DraftCard,
  extractSodWarnings,
  formatRoleLabel,
  prerequisitesForDraft,
} from "@/app/components/DraftCard";
import { formatRequestStatusLabel, Timeline } from "@/app/components/Timeline";
import type { DraftRecord } from "@/lib/drafts/drafts";
import type { RequestTimeline } from "@/lib/workflow/engine";

const sampleDraft: DraftRecord = {
  draft_id: "11111111-2222-3333-4444-555555555555",
  lineage_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  version: 1,
  kind: "access_request",
  payload: {
    requester_name: "Alex Chen",
    requester_type: "Contractor",
    sponsor: "Tom Gallagher",
    system_id: "SYS-CRM",
    access_level: "read",
    duration_days: 60,
    justification: "Customer-churn analysis",
  },
  approval_chain: [
    {
      seq: 1,
      role: "sponsor",
      approval_id: "APR-LM",
      approver_name: "Tom Gallagher",
      source_doc: "REF-005",
    },
    {
      seq: 2,
      role: "data_owner",
      approval_id: "APR-DO",
      approver_name: "Tom Gallagher",
      source_doc: "REF-005",
    },
    {
      seq: 3,
      role: "security_governance",
      approval_id: "APR-SG",
      approver_name: "Priya Nair",
      source_doc: "REF-005",
    },
    {
      seq: 4,
      role: "privacy_officer",
      approval_id: "APR-PO",
      approver_name: "Daniel Okafor",
      source_doc: "REF-005",
    },
  ],
  warnings: [
    {
      code: "separation_of_duties",
      approver_name: "Tom Gallagher",
      roles: ["sponsor", "data_owner"],
      message:
        "Separation of duties: sponsor and data owner are the same person (Tom Gallagher). Policy allows it; consider an independent reviewer.",
      citation: "REF-005",
    },
  ],
  policy_citations: ["REF-005", "POL-014", "POL-022"],
  status: "proposed",
  conversation_id: null,
};

const sampleTimeline: RequestTimeline = {
  request_id: "AR-0001",
  draft_id: sampleDraft.draft_id,
  status: "pending_approvals",
  sla_business_days: 5,
  sla_timeout_ms: 50_000,
  steps: [
    {
      seq: 1,
      role: "sponsor",
      approver_name: "Tom Gallagher",
      status: "approved",
      decided_at: "2026-11-14T01:00:00Z",
      decided_via: "simulated_approver_panel",
    },
    {
      seq: 2,
      role: "data_owner",
      approver_name: "Tom Gallagher",
      status: "pending",
      decided_at: null,
      decided_via: null,
    },
  ],
  events: [
    { event: "access_request.submitted", at: "2026-11-14T00:59:00Z" },
    {
      event: "step_approved",
      at: "2026-11-14T01:00:00Z",
      role: "sponsor",
      seq: 1,
      actor: "Tom Gallagher",
    },
  ],
};

describe("DraftCard and Timeline components (T057, US3, FR-023, FR-024)", () => {
  it("renders DraftCard with SoD warning, prerequisites, policy check, SIMULATED badge, and 'Submit request' / 'Cancel' buttons", () => {
    const html = renderToStaticMarkup(React.createElement(DraftCard, { draft: sampleDraft }));
    expect(html).toContain("SIMULATED");
    expect(html).toContain("Submit request");
    expect(html).toContain("Cancel");
    expect(html).toContain("Separation-of-duties warning");
    expect(html).toContain("Tom Gallagher");
    expect(html).toContain("Policy Check");
    expect(html).toContain("Prerequisites");
    expect(html).toContain("Verified background check (Restricted system)");
    expect(html).toContain("REF-005");
  });

  it("computes contractor and SYS-BILL prerequisites and extracts SoD warnings", () => {
    const prereqs = prerequisitesForDraft({
      ...sampleDraft,
      payload: { ...sampleDraft.payload, system_id: "SYS-BILL", vendor: "Brightline Analytics" },
    });
    expect(prereqs.map((p) => p.id)).toEqual([
      "nda",
      "training",
      "background_check",
      "vendor_assessment",
      "pci_training",
    ]);
    expect(extractSodWarnings(sampleDraft.warnings)).toHaveLength(1);
    expect(formatRoleLabel("privacy_officer")).toBe("Privacy Officer");
  });

  it("renders Timeline with 'Pending organisational approvals', SLA, steps, and events", () => {
    const html = renderToStaticMarkup(React.createElement(Timeline, { timeline: sampleTimeline }));
    expect(formatRequestStatusLabel("pending_approvals")).toBe("Pending organisational approvals");
    expect(html).toContain("AR-0001");
    expect(html).toContain("Pending organisational approvals");
    expect(html).toContain("SLA: 5 business days");
    expect(html).toContain("SIMULATED");
    expect(html).toContain("Step 1:");
    expect(html).toContain("Approved");
    expect(html).toContain("Pending");
  });
});
