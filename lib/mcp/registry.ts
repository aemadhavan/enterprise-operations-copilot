import type { z } from "zod";

/** Tool risk levels (Constitution V, ADR-004). */
export type ToolRisk = "read" | "propose" | "write";
export type ToolCaller = "agent" | "confirm";

/** Set only by POST /api/drafts/{id}/confirm (FR-010). Never produced by the agent loop. */
export interface ConfirmationEvent {
  draft_id: string;
  confirmed_by: string;
  at: string;
}

export interface ToolContext {
  caller: ToolCaller;
  confirmation?: ConfirmationEvent;
}

export interface ToolDef<I = unknown, O = unknown> {
  name: string;
  description: string;
  risk: ToolRisk;
  allowed_roles: ToolCaller[];
  input: z.ZodType<I>;
  handler(input: I, ctx: ToolContext): Promise<O>;
}

export const defineTool = <I, O>(t: ToolDef<I, O>): ToolDef<I, O> => t;

/** The agent loop may see `read` and `propose` tools only. Allow-list: unknown risk is excluded. */
export const AGENT_RISKS: readonly string[] = ["read", "propose"];
export const isAgentRisk = (risk: unknown) =>
  typeof risk === "string" && AGENT_RISKS.includes(risk);
