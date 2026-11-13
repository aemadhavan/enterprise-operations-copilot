---
doc_id: INC-2026-031
title: "Postmortem: Contractor retained Atlas CRM access after engagement ended"
doc_type: incident
version: "1.0"
effective_date: 2026-06-18
owner: Security Governance
classification: Confidential
source_system: Harbor Service Desk
synthetic: true
---

> SYNTHETIC DOCUMENT. Kestrel Financial Group is a fictional organisation created for demonstration purposes.

# Postmortem: Contractor retained Atlas CRM access after engagement ended

**Severity:** Medium · **Systems affected:** Atlas CRM (SYS-CRM), Gatekeeper IAM (SYS-IAM)

## Summary
A contractor from vendor **Brightline Analytics** kept read access to Atlas CRM for **47 days** after their engagement ended. It was discovered during the quarterly access review. A review of the session logs found no evidence of misuse.

## Root cause
- No end date was set on the contractor's account in Gatekeeper IAM.
- The sponsor did not raise an offboarding ticket (PRC-007, step 9).
- Quarterly reviews were too infrequent to catch the problem quickly.

## Actions
1. End date made a **mandatory field** in Gatekeeper IAM for all contractor accounts (CTL-02). Completed July 2026.
2. Contractor access to Restricted systems is now reviewed **monthly** (CTL-07, PRC-019 v1.1).
3. Maximum contractor access to Customer PII reduced from 180 to **90 days** (POL-014 v2.1).
