---
doc_id: REF-004
title: Control Catalogue
doc_type: reference
version: "1.3"
effective_date: 2026-10-15
owner: Security Governance
classification: Internal
source_system: Compass Wiki
synthetic: true
---

> SYNTHETIC DOCUMENT. Kestrel Financial Group is a fictional organisation created for demonstration purposes.

# Control Catalogue

| Control ID | Control | Requirement | Control owner |
|---|---|---|---|
| CTL-01 | Multi-factor authentication | Required for all access to Confidential and Restricted data | Identity & Access |
| CTL-02 | Time-bound access | Contractor access to Restricted data has an end date no more than 90 days away. Since July 2026 the end date is a mandatory field in Gatekeeper IAM. | Identity & Access |
| CTL-03 | Confidentiality agreement | Signed before any access is granted to a contractor | People Systems |
| CTL-04 | Security awareness training | Completed within the last 12 months | Security Governance |
| CTL-05 | Non-production masking | Customer data copied to non-production environments must be masked | Data Engineering |
| CTL-06 | Session logging and monitoring | All access to Restricted systems is logged. Since October 2026, DLP alerts fire on exports of more than 1,000 records. | Security Governance |
| CTL-07 | Periodic access review | Quarterly for all access; monthly for contractor access to Restricted systems | Security Governance |
| CTL-08 | Bulk export approval | Exporting more than 1,000 customer records requires written data owner approval. Enforced technically in Lumen Data Warehouse since October 2026. | Data Engineering |
| CTL-09 | Background check | Required for contractor access to Restricted data | People Systems |
| CTL-10 | PCI DSS training | Annual training, required before any access to payment card data | Finance Systems |
