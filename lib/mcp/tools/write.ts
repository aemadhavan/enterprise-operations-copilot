import { z } from "zod";
import { executeAccessRequest, type ExecuteDraftResult } from "@/lib/drafts/execute";
import { defineTool, type ConfirmationEvent } from "../registry";

export interface WriteToolDeps {
  executeAccess: (
    draft_id: string,
    confirmation: ConfirmationEvent | undefined,
  ) => Promise<ExecuteDraftResult>;
}

export const defaultWriteDeps: WriteToolDeps = {
  executeAccess: (draft_id, confirmation) => executeAccessRequest(draft_id, confirmation),
};

export const CreateAccessRequestInput = z.strictObject({
  draft_id: z.string().describe("UUID of the confirmed access-request draft"),
});

/**
 * Simulated write tools (T045, FR-010, FR-014, contracts/mcp-tools.md).
 * Declared with `risk: "write"` and `allowed_roles: ["confirm"]`: excluded from the agent loop's
 * MCP client and rejected by the MCP server without a matching `ConfirmationEvent`.
 */
export function writeTools(deps: WriteToolDeps = defaultWriteDeps) {
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
  ];
}
