import type { SearchArms } from "@/lib/retrieval/hybrid";

export interface GoldenCase {
  id: string;
  category: string;
  question: string;
  expected_route: string;
  expected_behaviour: string;
  expected_sources: string[];
  notes?: string;
}

export type Tier = "1a" | "1b" | "2";
export type Mode = "baseline" | "graphrag";
export type Milestone = "M2" | "M3" | "M4" | "M5";

export interface CaseResult {
  case_id: string;
  mode: Mode;
  arm: SearchArms;
  recall_at_5: number | null; // null = skipped (no expected sources)
  reciprocal_rank?: number | null; // MRR input, reported only
  retrieved_docs?: string[];
  expected_sources?: string[];
  latency_ms?: number;
}
