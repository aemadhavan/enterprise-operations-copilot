---
doc_id: POL-041
title: Privileged Access Management Policy
doc_type: policy
version: "1.2"
effective_date: 2026-04-01
owner: Identity & Access
classification: Internal
source_system: Compass Wiki
synthetic: true
---

> SYNTHETIC DOCUMENT. Kestrel Financial Group is a fictional organisation created for demonstration purposes.

# Privileged Access Management Policy

## 1. Scope
This policy covers administrator, root and other privileged access to production systems.

## 2. Requirements
- **2.1** Privileged access is granted only through the PAM vault in Gatekeeper IAM. Standing admin accounts are not permitted.
- **2.2** Privileged access is just-in-time, for a **maximum of 8 hours** per session.
- **2.3** Privileged access to any system holding Restricted data requires Security Governance approval, in addition to the standard approvals in REF-005.
- **2.4** All privileged sessions are recorded (CTL-06) and require MFA (CTL-01).

## 3. Contractors
Privileged access for contractors is exceptional. It requires the approval of the **Head of Security Governance** and is reviewed after every session.
