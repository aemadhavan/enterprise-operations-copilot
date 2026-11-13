---
doc_id: POL-014
title: Customer Data Access Policy
doc_type: policy
version: "2.1"
effective_date: 2026-08-01
owner: Security Governance
classification: Internal
source_system: Compass Wiki
synthetic: true
---

> SYNTHETIC DOCUMENT. Kestrel Financial Group is a fictional organisation created for demonstration purposes.

# Customer Data Access Policy

## 1. Scope
This policy applies to any access to Customer PII or customer contact details, in any system, by employees, contractors or vendor staff.

## 2. Principles
Access is granted on the basis of least privilege and need-to-know, for the shortest duration that meets the business need.

## 3. Requirements
- **3.1** All access to Customer PII must be requested through the Access Request and Approval Procedure (PRC-012).
- **3.2** Access to Restricted customer data requires multi-factor authentication (CTL-01) and session logging (CTL-06).
- **3.3** Contractors may be granted access to Customer PII only when a business justification is documented and the approvals in the Approval Matrix (REF-005) are obtained.
- **3.4** Contractor access to Customer PII is time-bound to a **maximum of 90 days** (CTL-02). It may be renewed **once** after re-approval.
- **3.5** Bulk export of more than **1,000 customer records** requires prior written approval from the system's data owner (CTL-08).
- **3.6** Production customer data must not be copied to non-production environments unless it is masked (CTL-05).
- **3.7** All access to customer data is subject to periodic access review (CTL-07, PRC-019).

## 4. Exceptions
Security Governance may approve an exception for up to 30 days. Every exception is recorded in the exceptions register with an owner and an expiry date.

## 5. Change history
- **v2.1 (2026-08-01):** Reduced the maximum contractor access duration from **180 days to 90 days**, following incident INC-2026-031.
- **v2.0 (2025-09-01):** Added the bulk export requirement (§3.5).
