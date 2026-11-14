import { z } from "zod";
import {
  createDraft,
  createOnboardingDraft,
  type CreateDraftInput,
  type CreateDraftResult,
  type CreateOnboardingDraftInput,
} from "@/lib/drafts/drafts";
import { checkPolicy, type PolicyCheckInput, type PolicyCheckResult } from "@/lib/policy/checks";
import { defineTool } from "../registry";

export interface ProposeToolDeps {
  check: (input: PolicyCheckInput) => PolicyCheckResult | Promise<PolicyCheckResult>;
  draft: (input: CreateDraftInput) => Promise<CreateDraftResult>;
  draftOnboarding?: (input: CreateOnboardingDraftInput) => Promise<CreateDraftResult>;
}

export const defaultProposeDeps: ProposeToolDeps = {
  check: checkPolicy,
  draft: (input) => createDraft(input),
  draftOnboarding: (input) => createOnboardingDraft(input),
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

export const ProposeOnboardingTicketInput = z.strictObject({
  contractor_name: z.string().describe("Full name of the contractor being onboarded"),
  vendor: z.string().optional().describe("Vendor / consulting firm name, e.g. Northgate Consulting"),
  sponsor: z.string().optional().describe("Stated Kestrel line-manager sponsor, if known"),
  start_date: z.string().describe("Engagement start date in ISO YYYY-MM-DD format"),
  end_date: z.string().describe("Engagement end date in ISO YYYY-MM-DD format"),
  restricted_access_expected: z
    .boolean()
    .describe("Whether the contractor is expected to need access to Restricted systems/data"),
});

/**
 * Policy-check (`read`) and draft-proposal (`propose`) MCP tools (T044, T069, FR-009, FR-014, FR-026, contracts/mcp-tools.md).
 * `propose_access_request` and `propose_onboarding_ticket` re-run `check_policy` / vendor checks in code
 * and never create an `access_requests` or `onboarding_tickets` business record.
 */
export function proposeTools(deps: ProposeToolDeps = defaultProposeDeps) {
  const draftOnboarding = deps.draftOnboarding ?? ((input) => createOnboardingDraft(input));
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
    defineTool({
      name: "propose_onboarding_ticket",
      description:
        "Create or supersede an immutable contractor onboarding-ticket DRAFT row only (status = proposed, FR-026). Flags supplier security assessments that are expired or expire before end_date (VND-002) and notes prerequisites (PRC-007, POL-022). Never executes the ticket.",
      risk: "propose",
      allowed_roles: ["agent"],
      input: ProposeOnboardingTicketInput,
      handler: async (input) => draftOnboarding(input),
    }),
  ];
}
