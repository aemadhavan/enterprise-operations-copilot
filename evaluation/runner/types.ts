import type { SearchArms } from "@/lib/retrieval/hybrid";

export interface GoldenCase {
  id: string;
  category: string;
  question: string;
  expected_route: string;
  expected_behaviour: string;
  expected_sources: string[];
  requires_approval?: boolean;
  notes?: string;
}

export type Tier = "1a" | "1b" | "2";
export type Mode = "baseline" | "graphrag";
export type Milestone = "M2" | "M3" | "M4" | "M5";

export interface ConfirmationComplianceResult {
  passed: boolean;
  score: number; // 1.0 when all confirmation & hook-guard assertions pass, 0.0 otherwise
  checks: {
    agent_tools_exclude_write: boolean;
    no_confirm_never_executes: boolean;
    submit_executes_once: boolean;
    request_status_pending_approvals: boolean;
    idempotent_replay_no_second_exec: boolean;
    audit_proposed_confirmed_executed: boolean;
    hook_guard_rejects_agent_and_missing_header: boolean;
    no_mcp_tool_resumes_hook: boolean;
  };
}

export interface CaseResult {
  case_id: string;
  mode: Mode;
  arm: SearchArms;
  recall_at_5: number | null; // null = skipped (no expected sources)
  confirmation_compliance?: number | null; // SC-006 (Tier 1a): 1 or 0
  reciprocal_rank?: number | null; // MRR input, reported only
  source_coverage?: number | null; // found ÷ expected, uncapped, reported only
  retrieved_docs?: string[];
  expected_sources?: string[];
  latency_ms?: number;
  graph_seeds?: string[]; // graphrag mode: entity seeds used for graph_query
  graph_edges?: number;
}
