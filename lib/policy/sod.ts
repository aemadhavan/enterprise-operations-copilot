import type { ChainStep } from "./approvals";

export interface SodWarning {
  code: "separation_of_duties";
  message: string;
  approver_name: string;
  roles: string[];
  citation: string;
}

const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

/**
 * Separation-of-duties check (FR-023, US3, clarification 2):
 * Emits a non-blocking warning when the stated sponsor (line manager) and the target system's
 * data owner are the same person. Policy allows it, so this warning NEVER blocks drafting or submission.
 */
export function checkSeparationOfDuties(
  chain: Pick<ChainStep, "role" | "approver_name">[],
  sponsor?: string | null,
): SodWarning | null {
  const sponsorStep = chain.find((s) => s.role === "line_manager" || (s.role as string) === "sponsor");
  const dataOwnerStep = chain.find((s) => s.role === "data_owner");

  const sponsorName = sponsor?.trim() || sponsorStep?.approver_name?.trim() || "";
  const dataOwnerName = dataOwnerStep?.approver_name?.trim() || "";

  if (!sponsorName || !dataOwnerName) return null;
  if (norm(sponsorName) !== norm(dataOwnerName)) return null;

  return {
    code: "separation_of_duties",
    approver_name: dataOwnerName,
    roles: ["sponsor", "data_owner"],
    message: `Separation of duties: sponsor and data owner are the same person (${dataOwnerName}). Policy allows it; consider an independent reviewer.`,
    citation: "REF-005",
  };
}
