import { z } from "zod";
import { createDraft, type CreateDraftInput, type CreateDraftResult } from "@/lib/drafts/drafts";
import { checkPolicy, type PolicyCheckInput, type PolicyCheckResult } from "@/lib/policy/checks";
import { defineTool } from "../registry";

export interface ProposeToolDeps {
  check: (input: PolicyCheckInput) => PolicyCheckResult | Promise<PolicyCheckResult>;
  draft: (input: CreateDraftInput) => Promise<CreateDraftResult>;
}

export const defaultProposeDeps: ProposeToolDeps = {
  check: checkPolicy,
  draft: (input) => createDraft(input),
};

export const CheckPolicyInput = z.strictObject({
  system_id: z.string().optional().describe("System node ID, e.g. SYS-CRM"),
  requester_type: z.enum(["Employee", "Contractor", "Vendor"]),
  access_level: z.enum(["read", "write", "admin"]).optional(),
  duration_days: z.number().int().optional().describe("Requested duration in calendar days"),
  vendor: z.string().optional().describe("Vendor organisation name or ID, if applicable"),
  start_date: z.string().optional().describe("ISO date YYYY-MM-DD"),
  end_date: z.string().optional().describe("ISO date YYYY-MM-DD"),
});

export const ProposeAccessRequestInput = z.strictObject({
  requester_name: z.string().describe("Full name of the person needing access"),
  requester_type: z.enum(["Employee", "Contractor", "Vendor"]),
  sponsor: z.string().optional().describe("Stated Kestrel sponsor / line manager"),
  system_id: z.string().describe("Target system ID, e.g. SYS-CRM"),
  access_level: z.enum(["read", "write", "admin"]),
  duration_days: z.number().int().describe("Requested duration in calendar days"),
  justification: z.string().optional().describe("Business justification for access"),
  vendor: z.string().optional().describe("Vendor organisation name, if vendor staff"),
  supersedes_draft_id: z.string().optional().describe("UUID of an existing proposed draft to supersede"),
});

/**
 * Policy-check (`read`) and draft-proposal (`propose`) MCP tools (T044, FR-009, FR-014, contracts/mcp-tools.md).
 * `propose_access_request` re-runs `check_policy` and the missing-fields check in code; it never creates
 * an `access_requests` business record.
 */
export function proposeTools(deps: ProposeToolDeps = defaultProposeDeps) {
  return [
    defineTool({
      name: "check_policy",
      description:
        "Deterministic policy check against Kestrel rules (90-day contractor PII/Restricted max + 30-day exception, no contractor admin on Restricted production systems, vendor assessment validity as of 2026-11-13). Always run before proposing a draft.",
      risk: "read",
      allowed_roles: ["agent"],
      input: CheckPolicyInput,
      handler: async (input) => deps.check(input),
    }),
    defineTool({
      name: "propose_access_request",
      description:
        "Create or supersede an immutable access-request DRAFT row only (status = proposed). Re-runs check_policy first (blocking breaches) and checks required fields (requester_name, requester_type, sponsor, system_id, access_level, duration_days, justification). Never executes the request.",
      risk: "propose",
      allowed_roles: ["agent"],
      input: ProposeAccessRequestInput,
      handler: async (input) => deps.draft(input),
    }),
  ];
}
