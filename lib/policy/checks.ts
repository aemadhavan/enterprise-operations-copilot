import type { AccessLevel, RequesterType } from "./approvals";

/** Scenario "today" pinned by CLAUDE.md and the constitution (2026-11-13). */
export const SCENARIO_TODAY = "2026-11-13";

export interface PolicyBreach {
  rule:
    | "contractor_duration_max"
    | "contractor_privileged_restricted"
    | "vendor_assessment_expired";
  limit: number | string;
  value: number | string;
  citation: string;
  alternative: string;
}

export interface PolicyWarning {
  code: "vendor_assessment_expires_before_end" | "vendor_not_stated" | "sponsor_not_stated";
  message: string;
  citation: string;
  valid_until?: string;
}

export interface PolicyCheckInput {
  system_id?: string | null;
  requester_type: RequesterType;
  access_level?: AccessLevel | null;
  duration_days?: number | null;
  vendor?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  restricted_access_expected?: boolean | null;
  today?: string;
}

export interface PolicyCheckResult {
  ok: boolean;
  breaches: PolicyBreach[];
  warnings: PolicyWarning[];
  citations: string[];
}

interface SystemMeta {
  id: string;
  name: string;
  classification: "Public" | "Internal" | "Confidential" | "Restricted";
  hasCustomerData: boolean;
}

const SYSTEMS: Record<string, SystemMeta> = {
  "SYS-CRM": {
    id: "SYS-CRM",
    name: "Atlas CRM",
    classification: "Restricted",
    hasCustomerData: true,
  },
  "SYS-DWH": {
    id: "SYS-DWH",
    name: "Lumen Data Warehouse",
    classification: "Restricted",
    hasCustomerData: true,
  },
  "SYS-BILL": {
    id: "SYS-BILL",
    name: "Ledger Billing",
    classification: "Restricted",
    hasCustomerData: true,
  },
  "SYS-HR": {
    id: "SYS-HR",
    name: "Pulse HRIS",
    classification: "Restricted",
    hasCustomerData: false,
  },
  "SYS-IAM": {
    id: "SYS-IAM",
    name: "Gatekeeper IAM",
    classification: "Restricted",
    hasCustomerData: false,
  },
  "SYS-HELP": {
    id: "SYS-HELP",
    name: "Harbor Service Desk",
    classification: "Confidential",
    hasCustomerData: true,
  },
  "SYS-WIKI": {
    id: "SYS-WIKI",
    name: "Compass Wiki",
    classification: "Internal",
    hasCustomerData: false,
  },
};

export interface VendorAssessment {
  id: string;
  name: string;
  rating: "Low" | "Medium" | "High";
  valid_until: string;
}

export const VENDOR_REGISTER: VendorAssessment[] = [
  {
    id: "VEN-BRIGHTLINE",
    name: "Brightline Analytics",
    rating: "Medium",
    valid_until: "2027-06-30",
  },
  {
    id: "VEN-NORTHGATE",
    name: "Northgate Consulting",
    rating: "Low",
    valid_until: "2026-12-31",
  },
  {
    id: "VEN-QUILLON",
    name: "Quillon Data Services",
    rating: "Medium",
    valid_until: "2026-09-30",
  },
];

export function resolveVendor(raw?: string | null): VendorAssessment | null {
  const q = (raw ?? "").trim().toLowerCase();
  if (!q) return null;
  return (
    VENDOR_REGISTER.find(
      (v) =>
        v.id.toLowerCase() === q ||
        v.name.toLowerCase() === q ||
        v.name.toLowerCase().includes(q) ||
        q.includes(v.name.split(" ")[0].toLowerCase()),
    ) ?? null
  );
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Deterministic policy checker (FR-011, FR-026, T042):
 * 1. Contractor / Vendor access to Customer PII or Restricted data is capped at 90 days
 *    (renewable once on re-approval; Security Governance exception up to 30 days, POL-014 §3.4/§4, POL-022 §3).
 * 2. Contractor / Vendor privileged (admin) access to production systems holding Restricted data
 *    is not permitted via standard access requests (POL-022 §4, POL-041 §3, GS-015).
 * 3. Vendor Supplier Security Assessment must be valid on `today` (2026-11-13) and through `end_date`
 *    (VND-002 §3 / Appendix A, POL-022 §5).
 */
export function checkPolicy(input: PolicyCheckInput): PolicyCheckResult {
  const today = input.today ?? SCENARIO_TODAY;
  const sys = input.system_id ? SYSTEMS[input.system_id] : undefined;
  const isExternal = input.requester_type === "Contractor" || input.requester_type === "Vendor";
  const isRestricted =
    sys ? sys.classification === "Restricted" : (input.restricted_access_expected ?? true);
  const touchesCustomerOrRestricted = sys
    ? sys.hasCustomerData || sys.classification === "Restricted"
    : true;
  const needsVendorAssessment = sys
    ? sys.classification === "Confidential" || sys.classification === "Restricted"
    : true;

  const breaches: PolicyBreach[] = [];
  const warnings: PolicyWarning[] = [];
  const citations = new Set<string>();

  // Rule 1: 90-day maximum for contractor access to Customer PII / Restricted data (POL-014 §3.4, POL-022 §3).
  if (
    isExternal &&
    touchesCustomerOrRestricted &&
    typeof input.duration_days === "number" &&
    input.duration_days > 90
  ) {
    const citation = sys?.hasCustomerData !== false ? "POL-014 §3.4" : "POL-022 §3";
    citations.add("POL-014");
    citations.add("POL-022");
    breaches.push({
      rule: "contractor_duration_max",
      limit: 90,
      value: input.duration_days,
      citation,
      alternative:
        "Request up to 90 days (renewable once after re-approval per POL-014 §3.4), or request a Security Governance exception for up to 30 days (POL-014 §4).",
    });
  }

  // Rule 2: Contractor admin on Restricted production systems is not permitted (POL-022 §4, POL-041 §3).
  if (isExternal && isRestricted && input.access_level === "admin") {
    citations.add("POL-022");
    citations.add("POL-041");
    breaches.push({
      rule: "contractor_privileged_restricted",
      limit: "read|write",
      value: "admin",
      citation: "POL-022 §4",
      alternative:
        "Request read or write access instead, or raise a privileged access exception under POL-041 §3 requiring Head of Security Governance (Priya Nair) approval and per-session review (max 8 hours via Gatekeeper IAM PAM vault, POL-041 §2.1–§2.2).",
    });
  }

  // Rule 3: Vendor assessment validity against today (2026-11-13) and end_date (VND-002, POL-022 §5).
  const vendor = resolveVendor(input.vendor);
  if (vendor && needsVendorAssessment) {
    const startDate = input.start_date ?? today;
    const endDate =
      input.end_date ??
      (typeof input.duration_days === "number" && input.duration_days > 0
        ? addDaysIso(startDate, input.duration_days)
        : null);

    if (vendor.valid_until < today) {
      citations.add("VND-002");
      citations.add("POL-022");
      breaches.push({
        rule: "vendor_assessment_expired",
        limit: today,
        value: vendor.valid_until,
        citation: "VND-002 §3",
        alternative: `Renew the Supplier Security Assessment for ${vendor.name} (expired ${vendor.valid_until}) before granting new access (VND-002 §3, POL-022 §5).`,
      });
    } else if (endDate && endDate > vendor.valid_until) {
      citations.add("VND-002");
      citations.add("POL-022");
      warnings.push({
        code: "vendor_assessment_expires_before_end",
        message: `${vendor.name}'s Supplier Security Assessment is valid until ${vendor.valid_until}, which expires before the engagement end date (${endDate}); renewal is required (VND-002 Appendix A).`,
        citation: "VND-002 Appendix A",
        valid_until: vendor.valid_until,
      });
    }
  }

  return {
    ok: breaches.length === 0,
    breaches,
    warnings,
    citations: [...citations],
  };
}
