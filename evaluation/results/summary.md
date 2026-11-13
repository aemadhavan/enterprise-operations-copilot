# Eval summary: Tier 1a, M3

Run 2026-11-13T23:23:40.274Z · 9 cases · 1.8 s · embedding voyage-3.5 · dataset 72a625175df3 · graph: graphrag = hybrid text + graph_query node mode from resolved entities (graph-route cases)

## Gates

| SC | Metric | Mode | Value | Threshold | Cases | Result |
|---|---|---|---|---|---|---|
| SC-010 | recall_at_5 (hybrid) | baseline | 78% | 90% | 9 | ❌ fail |
| SC-010 | recall_at_5 (hybrid) | graphrag | 100% | 90% | 9 | ✅ pass |

No regressions vs last pass.

## Reported metrics (not gated)

| Mode | recall@5 hybrid | coverage hybrid | MRR hybrid |
|---|---|---|---|
| baseline | 78% | 77% | 0.74 |
| graphrag | 100% | 100% | 0.74 |

recall@5 (gated) = found ÷ min(5, expected). Coverage = found ÷ expected, uncapped, same retrieved set.
MRR = mean of 1 / rank of the first expected source among distinct retrieved doc IDs.

## Per case

| Case | Mode | recall@5 hybrid | coverage hybrid | RR hybrid | Expected | Top-5 docs (hybrid) |
|---|---|---|---|---|---|---|
| GS-009 | baseline | 40% | 33% | 0.33 | REF-003, POL-001, REF-005, POL-014, POL-022, PRC-019 | POL-041, PRC-012, POL-014, REF-004, REF-005 |
| GS-009 | graphrag | 100% | 100% | 0.33 | REF-003, POL-001, REF-005, POL-014, POL-022, PRC-019 | POL-041, PRC-012, POL-014, REF-004, REF-005 |
| GS-010 | baseline | 100% | 100% | 1.00 | REF-003 | REF-003, PRC-019, REF-005, POL-001, POL-030 |
| GS-010 | graphrag | 100% | 100% | 1.00 | REF-003 | REF-003, PRC-019, REF-005, POL-001, POL-030 |
| GS-011 | baseline | 67% | 67% | 0.50 | REF-003, REF-005, REF-004 | POL-022, REF-005, POL-041, REF-004, POL-014 |
| GS-011 | graphrag | 100% | 100% | 0.50 | REF-003, REF-005, REF-004 | POL-022, REF-005, POL-041, REF-004, POL-014 |
| GS-012 | baseline | 100% | 100% | 1.00 | REF-003, POL-014, REF-004 | REF-003, REF-004, INC-2026-031, POL-001, POL-014 |
| GS-012 | graphrag | 100% | 100% | 1.00 | REF-003, POL-014, REF-004 | REF-003, REF-004, INC-2026-031, POL-001, POL-014 |
| GS-013 | baseline | 100% | 100% | 0.33 | INC-2026-031, INC-2026-044 | REF-004, MTG-2026-10-14, INC-2026-044, POL-014, INC-2026-031 |
| GS-013 | graphrag | 100% | 100% | 0.33 | INC-2026-031, INC-2026-044 | REF-004, MTG-2026-10-14, INC-2026-044, POL-014, INC-2026-031 |
| GS-014 | baseline | 50% | 50% | 1.00 | VND-002, REF-003, REF-005, POL-022 | REF-003, INC-2026-044, POL-022, INC-2026-031, POL-001 |
| GS-014 | graphrag | 100% | 100% | 1.00 | VND-002, REF-003, REF-005, POL-022 | REF-003, INC-2026-044, POL-022, INC-2026-031, POL-001 |
| GS-015 | baseline | 75% | 75% | 1.00 | POL-022, POL-041, REF-005, REF-003 | POL-041, REF-005, POL-022, MTG-2026-10-14, POL-014 |
| GS-015 | graphrag | 100% | 100% | 1.00 | POL-022, POL-041, REF-005, REF-003 | POL-041, REF-005, POL-022, MTG-2026-10-14, POL-014 |
| GS-016 | baseline | 67% | 67% | 1.00 | PRC-007, PRC-012, PRC-019 | PRC-019, REF-003, PRC-012, INC-2026-031, POL-041 |
| GS-016 | graphrag | 100% | 100% | 1.00 | PRC-007, PRC-012, PRC-019 | PRC-019, REF-003, PRC-012, INC-2026-031, POL-041 |
| GS-021 | baseline | 100% | 100% | 0.50 | VND-002, POL-022 | POL-014, VND-002, POL-022, POL-001, REF-003 |
| GS-021 | graphrag | 100% | 100% | 0.50 | VND-002, POL-022 | POL-014, VND-002, POL-022, POL-001, REF-003 |
| **mean** | baseline | 78% | 77% | 0.74 | | |
| **mean** | graphrag | 100% | 100% | 0.74 | | |

Only the hybrid arm is gated; `fts` (full-text only) and `vector` (vector only) are diagnostic.
Skipped (—) = no expected sources for that case.
