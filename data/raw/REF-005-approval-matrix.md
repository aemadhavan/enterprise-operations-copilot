---
doc_id: REF-005
title: Access Approval Matrix
doc_type: reference
version: "4.0"
effective_date: 2026-08-01
owner: Security Governance
classification: Internal
source_system: Compass Wiki
synthetic: true
---

> SYNTHETIC DOCUMENT. Kestrel Financial Group is a fictional organisation created for demonstration purposes.

# Access Approval Matrix

Approvals are determined by the requester type and the **highest classification** of the target system (REF-003).

## 1. Standard access (read or write)
| Requester type | Internal | Confidential | Restricted |
|---|---|---|---|
| Employee | Line manager | Line manager + Data owner | Line manager + Data owner + Security Governance |
| Contractor | Line manager (sponsor) | Line manager + Data owner + Security Governance | Line manager + Data owner + Security Governance + Privacy Officer |

## 2. Privileged (admin) access
Privileged access to any system holding Restricted data additionally requires Security Governance approval through the PAM process (POL-041). For contractors it also requires the Head of Security Governance (POL-022 §4).

## 3. Payment card data
Access to any system that stores payment card data additionally requires sign-off from the **Finance Systems Lead** and completed **PCI DSS training (CTL-10)**.

## 4. Named approvers
| Approval | Approver |
|---|---|
| Line manager | The requester's sponsor |
| Data owner | As listed in the System Inventory (REF-003) |
| Security Governance | Priya Nair, Head of Security Governance (or delegate) |
| Privacy Officer | Daniel Okafor |
| Finance Systems Lead | Sofia Reyes |
| Head of Security Governance | Priya Nair (no delegation) |
