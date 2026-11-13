---
doc_id: REF-003
title: System Inventory
doc_type: reference
version: "2026.10"
effective_date: 2026-10-01
owner: Identity & Access
classification: Internal
source_system: Harbor Service Desk CMDB
synthetic: true
---

> SYNTHETIC DOCUMENT. Kestrel Financial Group is a fictional organisation created for demonstration purposes.

# System Inventory

The highest classification of a system follows POL-001 §3: it is the highest classification of any data category the system stores.

| System ID | Name | Purpose | Data categories stored | Highest classification | Technical owner team | Data owner |
|---|---|---|---|---|---|---|
| SYS-CRM | Atlas CRM | Customer accounts and interactions | Customer PII; Customer contact details | Restricted | Customer Platforms | Tom Gallagher |
| SYS-DWH | Lumen Data Warehouse | Analytics and reporting | Customer PII; Financial records; Operational data | Restricted | Data Engineering | Mei Lin Tan |
| SYS-BILL | Ledger Billing | Invoicing and payments | Payment card data; Financial records; Customer contact details | Restricted | Finance Systems | Sofia Reyes |
| SYS-HELP | Harbor Service Desk | IT and customer support tickets | Customer contact details; Operational data | Confidential | IT Service Management | Grace Whitfield |
| SYS-WIKI | Compass Wiki | Internal knowledge base | Operational data | Internal | Digital Workplace | Liam Novak |
| SYS-HR | Pulse HRIS | Employee and contractor records | Employee PII | Restricted | People Systems | Hannah Brooks |
| SYS-IAM | Gatekeeper IAM | Identity, access and PAM vault | Employee PII; Operational data | Restricted | Identity & Access | Arjun Mehta |

## Data flows
- Atlas CRM → Lumen Data Warehouse (nightly customer data load)
- Ledger Billing → Lumen Data Warehouse (nightly financial data load)
