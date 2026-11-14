import type { AccessRequestSubmittedEvent } from "@/app/api/drafts/[id]/confirm/route";
import { getConfig } from "@/lib/config";

export type RequestStatus = "pending_approvals" | "approved" | "rejected" | "expired";
export type StepStatus = "pending" | "approved" | "rejected" | "sla_breached";

export interface ApprovalStepState {
  seq: number;
  role: string;
  approver_name: string | null;
  status: StepStatus;
  decided_at: string | null;
  decided_via: "simulated_approver_panel" | null;
}

export interface TimelineEvent {
  event: string;
  at: string;
  role?: string;
  seq?: number;
  actor?: string;
}

export interface RequestTimeline {
  request_id: string;
  draft_id?: string;
  status: RequestStatus;
  sla_business_days: number;
  sla_timeout_ms: number;
  steps: ApprovalStepState[];
  events: TimelineEvent[];
}

export interface ResumeApprovalInput {
  request_id: string;
  role: string;
  decision: "approve" | "reject";
  actor?: string;
}

export interface ApprovalEngine {
  start(event: AccessRequestSubmittedEvent): Promise<RequestTimeline>;
  status(request_id: string): Promise<RequestTimeline | null>;
  resume(input: ResumeApprovalInput): Promise<RequestTimeline>;
}

/**
 * Scale business-day SLA to demo seconds using `SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY` (FR-024b).
 * A 5-business-day SLA with scale N becomes `5 * N` seconds (`5 * N * 1000` ms).
 */
export function scaledSlaSeconds(
  sla_business_days: number,
  secondsPerBusinessDay = getConfig().SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY,
): number {
  return sla_business_days * secondsPerBusinessDay;
}

export function scaledSlaMs(
  sla_business_days: number,
  secondsPerBusinessDay = getConfig().SLA_TIME_SCALE_SECONDS_PER_BUSINESS_DAY,
): number {
  return scaledSlaSeconds(sla_business_days, secondsPerBusinessDay) * 1000;
}
