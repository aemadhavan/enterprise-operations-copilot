---
doc_id: POL-001
title: Information Classification Policy
doc_type: policy
version: "3.0"
effective_date: 2026-03-01
owner: Security Governance
classification: Internal
source_system: Compass Wiki
synthetic: true
---

> SYNTHETIC DOCUMENT. Kestrel Financial Group is a fictional organisation created for demonstration purposes.

# Information Classification Policy

## 1. Purpose
This policy defines how Kestrel Financial Group classifies information so that the level of protection matches the harm that unauthorised disclosure would cause.

## 2. Classification levels
- **Public**: approved for public release. No access restrictions.
- **Internal**: the default for business information. Available to staff and to contractors with an active engagement.
- **Confidential**: financial records and customer contact details. Access on a need-to-know basis with data owner approval.
- **Restricted**: the highest level. Customer PII, payment card data and employee PII. Access only through an approved access request (PRC-012), with multi-factor authentication and session logging. Restricted data must never be stored on personal devices.

## 3. Data category mapping
| Data category | Classification |
|---|---|
| Customer PII | Restricted |
| Payment card data | Restricted |
| Employee PII | Restricted |
| Financial records | Confidential |
| Customer contact details | Confidential |
| Operational data | Internal |

A system takes the highest classification of any data category it stores.

## 4. Responsibilities
- **Data owners** (named in the System Inventory, REF-003) classify the data in their systems and approve access.
- **Security Governance** maintains this policy and the Control Catalogue (REF-004).

## 5. Review
This policy is reviewed annually by Security Governance.
