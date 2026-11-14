"use client";

import React from "react";
import type { RequestStatus, RequestTimeline, StepStatus } from "@/lib/workflow/engine";
import { formatRoleLabel } from "./DraftCard";

export function formatRequestStatusLabel(status: RequestStatus): string {
  switch (status) {
    case "pending_approvals":
      return "Pending organisational approvals";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired (SLA breached)";
    default:
      return status;
  }
}

export function formatStepStatusLabel(status: StepStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "sla_breached":
      return "SLA Breached";
    default:
      return status;
  }
}

export interface TimelineProps {
  timeline: RequestTimeline;
  onRefresh?: () => Promise<void> | void;
  refreshing?: boolean;
}

export function Timeline({ timeline, onRefresh, refreshing = false }: TimelineProps) {
  return (
    <section
      className="timeline-card"
      aria-label={`Approval status timeline for ${timeline.request_id}`}
      data-testid="request-timeline"
    >
      <header className="timeline-header">
        <div className="timeline-title-group">
          <h3 className="timeline-title">
            Request <code>{timeline.request_id}</code>
          </h3>
          <span
            className={`badge badge-req-status badge-req-${timeline.status}`}
            data-testid="timeline-request-status"
          >
            {formatRequestStatusLabel(timeline.status)}
          </span>
          <span className="badge badge-route">SLA: {timeline.sla_business_days} business days</span>
        </div>
        <div className="timeline-header-actions">
          <span className="badge badge-simulated">SIMULATED</span>
          {onRefresh && (
            <button
              type="button"
              className="sample-btn"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              data-testid="timeline-refresh-btn"
            >
              {refreshing ? "Refreshing…" : "Refresh status"}
            </button>
          )}
        </div>
      </header>

      <div className="timeline-section">
        <h4>Approval Chain Progress</h4>
        <ol className="timeline-steps" data-testid="timeline-steps">
          {timeline.steps.map((step) => (
            <li
              key={step.seq}
              className={`timeline-step timeline-step-${step.status}`}
              data-testid={`timeline-step-${step.seq}`}
            >
              <div className="timeline-step-main">
                <span className="timeline-step-seq">Step {step.seq}:</span>{" "}
                <strong>{formatRoleLabel(step.role)}</strong>
                {step.approver_name && (
                  <span className="timeline-step-approver"> ({step.approver_name})</span>
                )}
              </div>
              <div className="timeline-step-meta">
                <span className={`badge badge-step-${step.status}`}>
                  {formatStepStatusLabel(step.status)}
                </span>
                {step.decided_at && (
                  <span className="timeline-timestamp">
                    {new Date(step.decided_at).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {timeline.events.length > 0 && (
        <div className="timeline-section">
          <h4>Audit & Workflow Events</h4>
          <ul className="timeline-events" data-testid="timeline-events">
            {timeline.events.map((ev, idx) => (
              <li key={`${ev.event}-${ev.at}-${idx}`} className="timeline-event-item">
                <code>{ev.event}</code>
                {ev.role && <span> · {formatRoleLabel(ev.role)}</span>}
                {ev.actor && <span> · by {ev.actor}</span>}
                <span className="timeline-timestamp">
                  {" "}
                  ({new Date(ev.at).toLocaleTimeString()})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="timeline-footer">
        <a
          href={`/approver?request_id=${encodeURIComponent(timeline.request_id)}`}
          className="trace-link"
        >
          Open Simulated Approver Panel ▸
        </a>
        <a
          href={`/audit?request_id=${encodeURIComponent(timeline.request_id)}`}
          className="trace-link"
        >
          View Audit Log ▸
        </a>
      </footer>
    </section>
  );
}
