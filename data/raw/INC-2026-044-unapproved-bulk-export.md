---
doc_id: INC-2026-044
title: "Postmortem: Unapproved bulk export from Lumen Data Warehouse"
doc_type: incident
version: "1.0"
effective_date: 2026-09-03
owner: Security Governance
classification: Confidential
source_system: Harbor Service Desk
synthetic: true
---

> SYNTHETIC DOCUMENT. Kestrel Financial Group is a fictional organisation created for demonstration purposes.

# Postmortem: Unapproved bulk export from Lumen Data Warehouse

**Severity:** High · **System affected:** Lumen Data Warehouse (SYS-DWH)

## Summary
An analyst exported **12,400 customer records** from Lumen Data Warehouse to a spreadsheet for a marketing campaign, without the data owner approval required by POL-014 §3.5. The file was found and deleted within 2 days. A privacy assessment by the Privacy Office found no external disclosure.

## Root cause
- No technical control limited export size. The approval requirement relied on staff awareness alone.
- Exports were not being monitored.

## Actions
1. Exports of more than 1,000 customer records are now blocked unless the data owner approves (CTL-08). Completed October 2026.
2. DLP alerting added for large exports from Restricted systems (CTL-06). Completed October 2026.
3. Refresher training on POL-014 for all analytics staff.
