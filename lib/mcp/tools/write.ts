import { z } from "zod";
import {
  executeAccessRequest,
  executeOnboardingTicket,
  type ExecuteDraftResult,
  type ExecuteOnboardingResult,
} from "@/lib/drafts/execute";
import { defineTool, type ConfirmationEvent } from "../registry";

export interface WriteToolDeps {
  executeAccess: (
    draft_id: string,
    confirmation: ConfirmationEvent | undefined,
  ) => Promise<ExecuteDraftResult>;
  executeOnboarding?: (
    draft_id: string,
    confirmation: ConfirmationEvent | undefined,
  ) => Promise<ExecuteOnboardingResult>;
}

export const defaultWriteDeps: WriteToolDeps = {
  executeAccess: (draft_id, confirmation) => executeAccessRequest(draft_id, confirmation),
  executeOnboarding: (draft_id, confirmation) => executeOnboardingTicket(draft_id, confirmation),
};

export const CreateAccessRequestInput = z.strictObject({
  draft_id: z.string().describe("UUID of the confirmed access-request draft"),
});

export const CreateOnboardingTicketInput = z.strictObject({
  draft_id: z.string().describe("UUID of the confirmed onboarding-ticket draft"),
});

/**
 * Simulated write tools (T045, T069, FR-010, FR-014, FR-026, contracts/mcp-tools.md).
 * Declared with `risk: "write"` and `allowed_roles: ["confirm"]`: excluded from the agent loop's
 * MCP client and rejected by the MCP server without a matching `ConfirmationEvent`.
 */
export function writeTools(deps: WriteToolDeps = defaultWriteDeps) {
  const executeOnboarding =
    deps.executeOnboarding ??
    ((draft_id: string, confirmation: ConfirmationEvent | undefined) =>
      executeOnboardingTicket(draft_id, confirmation));
  return [
    defineTool({
      name: "create_access_request",
      description:
        "Simulated ITSM write tool: executes a confirmed access-request draft once (idempotent on draft_id). Callable only from the confirm route with a ConfirmationEvent.",
      risk: "write",
      allowed_roles: ["confirm"],
      input: CreateAccessRequestInput,
      handler: async ({ draft_id }, ctx) => deps.executeAccess(draft_id, ctx.confirmation),
    }),
    defineTool({
      name: "create_onboarding_ticket",
      description:
        "Simulated Harbor Service Desk write tool: executes a confirmed contractor onboarding-ticket draft once (idempotent on draft_id, TKT-0001). Callable only from the confirm route with a ConfirmationEvent.",
      risk: "write",
      allowed_roles: ["confirm"],
      input: CreateOnboardingTicketInput,
      handler: async ({ draft_id }, ctx) => executeOnboarding(draft_id, ctx.confirmation),
    }),
  ];
}
