# Graph seed

Synthetic knowledge graph for Kestrel Financial Group (fictional).

- `nodes.csv`: `id, label, name, classification, description, source_doc`
- `edges.csv`: `source, relation, target, condition, source_doc`

Every node and edge carries a `source_doc`, so graph answers can be cited exactly like text answers (Constitution I).

## Node labels
Policy · Process · System · DataClass · Team · Person · Role · Approval · Control · Vendor · Incident

## Relations
| Relation | From → To | Meaning |
|---|---|---|
| governs | Policy → Process | Policy sets the rules for the process (`condition` narrows it) |
| protects | Policy → DataClass | Policy covers the data class |
| uses | Process → System | Process runs in or touches the system |
| stores | System → DataClass | System holds that data category |
| feeds | System → System | Data flows from source to target |
| owned_by | System → Team | Technical owner |
| data_owner | System → Person | Approves access and exports |
| member_of | Person → Team | |
| responsible_for | Person → Process | Process owner (`condition` scopes it, e.g. per system) |
| requires | DataClass/Role → Control/Approval | Requirement; `condition` holds the classification or requester filter |
| approved_by | Approval → Person | Named approver. **Data owner approval** is resolved through the target system's `data_owner` edge. |
| assessed_under | Vendor → Policy | Supplier assessment status (in `condition`) |
| affects | Incident → System | |
| involved | Incident → Vendor | |
| led_to | Incident → Control/Policy | Remediation |
| implemented_by | Control → Process | The procedure that carries out the control (e.g. CTL-07 periodic access review → PROC-REVIEW, PRC-019) |

## Conditions
`classification=Confidential|Restricted` means the edge applies when the target system's highest classification is either value. A system's highest classification is the max over its `stores` edges (POL-001 §3), and is precomputed in `nodes.csv` for convenience.

## Hero traversal (GS-009)
```
SYS-CRM -stores-> DC-CUST-PII (Restricted) -requires-> CTL-01, CTL-05, CTL-06, CTL-07, CTL-08, CTL-02[Contractor]
ROLE-CONTRACTOR -requires[Restricted]-> APR-LM, APR-DO, APR-SEC, APR-PRIV ; CTL-03, CTL-04, CTL-09, CTL-02
APR-DO -> SYS-CRM -data_owner-> PER-TGALLAGHER
APR-SEC -approved_by-> PER-PNAIR ; APR-PRIV -approved_by-> PER-DOKAFOR
```
