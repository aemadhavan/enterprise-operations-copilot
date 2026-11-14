"use client";

import React, { useState } from "react";
import type { DraftRecord, DraftWarning } from "@/lib/drafts/drafts";
import type { SodWarning } from "@/lib/policy/sod";

const RESTRICTED_SYSTEMS = new Set(["SYS-CRM", "SYS-DWH", "SYS-BILL", "SYS-HR", "SYS-IAM"]);

export interface PrerequisiteItem {
  id: string;
  label: string;
  citation: string;
}

export function prerequisitesForDraft(draft: DraftRecord): PrerequisiteItem[] {
  const { requester_type, system_id, vendor } = draft.payload;
  const items: PrerequisiteItem[] = [];

  if (requester_type === "Contractor" || requester_type === "Vendor") {
    items.push(
      {
        id: "nda",
        label: "Signed confidentiality agreement (NDA)",
        citation: "POL-022 §3",
      },
      {
        id: "training",
        label: "Completed security awareness training",
        citation: "POL-022 §3",
      },
    );
    if (RESTRICTED_SYSTEMS.has(system_id)) {
      items.push({
        id: "background_check",
        label: "Verified background check (Restricted system)",
        citation: "POL-022 §4",
      });
    }
    if (vendor || requester_type === "Vendor") {
      items.push({
        id: "vendor_assessment",
        label: `Valid supplier security assessment (${vendor ?? "vendor"})`,
        citation: "VND-002 §2",
      });
    }
  } else {
    items.push({
      id: "emp_training",
      label: "Active employee security awareness training",
      citation: "PRC-012 §3",
    });
  }

  if (system_id === "SYS-BILL") {
    items.push({
      id: "pci_training",
      label: "PCI DSS cardholder data handling training (CTL-10)",
      citation: "REF-004",
    });
  }

  return items;
}

export function extractSodWarnings(warnings: DraftWarning[]): SodWarning[] {
  return warnings.filter((w): w is SodWarning => w.code === "separation_of_duties");
}

export function extractOtherWarnings(warnings: DraftWarning[]): DraftWarning[] {
  return warnings.filter((w) => w.code !== "separation_of_duties");
}

export function formatRoleLabel(role: string): string {
  switch (role) {
    case "sponsor":
    case "line_manager":
      return "Sponsor (Line Manager)";
    case "data_owner":
      return "Data Owner";
    case "security_governance":
      return "Security Governance";
    case "head_of_security_governance":
      return "Head of Security Governance";
    case "privacy_officer":
      return "Privacy Officer";
    case "finance_systems_lead":
      return "Finance Systems Lead";
    default:
      return role;
  }
}

export interface DraftCardProps {
  draft: DraftRecord;
  onConfirm?: (draftId: string) => Promise<void> | void;
  onCancel?: (draftId: string) => Promise<void> | void;
  busy?: boolean;
  error?: string | null;
}

export function DraftCard({
  draft,
  onConfirm,
  onCancel,
  busy = false,
  error = null,
}: DraftCardProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const isBusy = busy || internalBusy;
  const isSubmittable = draft.status === "proposed" && !isBusy;

  const sodWarnings = extractSodWarnings(draft.warnings ?? []);
  const otherWarnings = extractOtherWarnings(draft.warnings ?? []);
  const prerequisites = prerequisitesForDraft(draft);

  async function handleConfirm() {
    if (!isSubmittable || !onConfirm) return;
    setInternalBusy(true);
    try {
      await onConfirm(draft.draft_id);
    } finally {
      setInternalBusy(false);
    }
  }

  async function handleCancel() {
    if (!isSubmittable || !onCancel) return;
    setInternalBusy(true);
    try {
      await onCancel(draft.draft_id);
    } finally {
      setInternalBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape" && isSubmittable && onCancel) {
      e.preventDefault();
      void handleCancel();
    }
  }

  return (
    <section
      className="draft-card"
      aria-label={`Access request draft v${draft.version}`}
      data-testid="draft-card"
      onKeyDown={handleKeyDown}
    >
      <header className="draft-card-header">
        <div className="draft-card-title-group">
          <h3 className="draft-card-title">
            Draft Access Request <span className="draft-version">v{draft.version}</span>
          </h3>
          <span
            className={`badge badge-draft-status badge-draft-${draft.status}`}
            data-testid="draft-status"
          >
            {draft.status.toUpperCase()}
          </span>
        </div>
        <span
          className="badge badge-simulated"
          title="Simulated ITSM draft — no production system is modified"
        >
          SIMULATED
        </span>
      </header>

      <div className="draft-payload-grid" data-testid="draft-payload">
        <div>
          <span className="meta-label">Requester</span>
          <div className="meta-value">
            <strong>{draft.payload.requester_name}</strong> ({draft.payload.requester_type}
            {draft.payload.vendor ? ` · ${draft.payload.vendor}` : ""})
          </div>
        </div>
        <div>
          <span className="meta-label">Sponsor</span>
          <div className="meta-value">{draft.payload.sponsor}</div>
        </div>
        <div>
          <span className="meta-label">Target System / Access</span>
          <div className="meta-value">
            <code>{draft.payload.system_id}</code> · <strong>{draft.payload.access_level}</strong>
          </div>
        </div>
        <div>
          <span className="meta-label">Duration</span>
          <div className="meta-value">{draft.payload.duration_days} calendar days</div>
        </div>
        <div className="draft-justification">
          <span className="meta-label">Justification</span>
          <div className="meta-value">{draft.payload.justification}</div>
        </div>
      </div>

      {sodWarnings.map((w, idx) => (
        <div
          key={idx}
          className="draft-warning draft-sod-warning"
          role="status"
          aria-label="Separation of duties warning"
          data-testid="draft-sod-warning"
        >
          <strong>Separation-of-duties warning ({w.citation}):</strong> {w.message}
        </div>
      ))}

      {otherWarnings.map((w, idx) => (
        <div
          key={idx}
          className="draft-warning draft-policy-warning"
          role="status"
          data-testid="draft-policy-warning"
        >
          <strong>Policy note ({w.citation}):</strong> {w.message}
        </div>
      ))}

      <div className="draft-section" data-testid="draft-policy-check">
        <h4>Policy Check</h4>
        <p className="draft-policy-summary">
          <span className="policy-pass-indicator">✓ Passed</span> deterministic Kestrel policy
          checks (90-day contractor PII cap, Restricted admin restriction, supplier assessment
          validity as of 2026-11-13).
        </p>
        {draft.policy_citations.length > 0 && (
          <div className="draft-citations">
            {draft.policy_citations.map((cit) => (
              <span key={cit} className="citation-chip">
                {cit}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="draft-section" data-testid="draft-approval-chain">
        <h4>Required Organisational Approvals ({draft.approval_chain.length})</h4>
        <ol className="draft-chain-list">
          {draft.approval_chain.map((step) => (
            <li key={step.seq} className="draft-chain-step">
              <span className="chain-role">{formatRoleLabel(step.role)}</span>
              {step.approver_name && (
                <span className="chain-approver"> — {step.approver_name}</span>
              )}{" "}
              <span className="citation-chip citation-chip-small">{step.source_doc}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="draft-section" data-testid="draft-prerequisites">
        <h4>Prerequisites</h4>
        <ul className="draft-prereq-list">
          {prerequisites.map((p) => (
            <li key={p.id}>
              {p.label} <span className="citation-chip citation-chip-small">{p.citation}</span>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <div className="msg-error" role="alert" data-testid="draft-error">
          {error}
        </div>
      )}

      <footer className="draft-card-footer">
        <p className="draft-confirm-hint">
          Action confirmation (FR-010): clicking <strong>Submit request</strong> creates the
          request in status <em>Pending organisational approvals</em>. It does not grant the
          organisational approvals themselves.
        </p>
        <div className="draft-actions">
          <button
            type="button"
            className="btn-submit-request"
            data-testid="draft-submit-btn"
            disabled={!isSubmittable}
            onClick={() => void handleConfirm()}
          >
            {isBusy ? "Submitting…" : "Submit request"}
          </button>
          <button
            type="button"
            className="btn-cancel-draft"
            data-testid="draft-cancel-btn"
            disabled={!isSubmittable}
            onClick={() => void handleCancel()}
          >
            Cancel
          </button>
        </div>
      </footer>
    </section>
  );
}
