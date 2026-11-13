# Eval summary: Tier 1a, M2

Run 2026-11-13T22:01:59.793Z · 11 cases · 3.4 s · embedding voyage-3.5 · dataset 72a625175df3 · graph: not yet implemented (T025); graphrag = baseline in M2

## Gates

| SC | Metric | Mode | Value | Threshold | Cases | Result |
|---|---|---|---|---|---|---|
| SC-010 | recall_at_5 (hybrid) | baseline | 100% | 90% | 10 | ✅ pass |
| SC-010 | recall_at_5 (hybrid) | graphrag | 100% | 90% | 10 | ✅ pass |

No regressions vs last pass.

## Per case

| Case | Mode | recall@5 hybrid | recall@5 fts | recall@5 vector | Expected | Top-5 docs (hybrid) |
|---|---|---|---|---|---|---|
| GS-001 | baseline | 100% | 100% | 100% | POL-014 | POL-014, INC-2026-031, POL-022, POL-041, POL-001 |
| GS-001 | graphrag | 100% | 100% | 100% | POL-014 | POL-014, INC-2026-031, POL-022, POL-041, POL-001 |
| GS-002 | baseline | 100% | 100% | 100% | POL-030 | POL-030, PRC-012, PRC-019, POL-014, REF-004 |
| GS-002 | graphrag | 100% | 100% | 100% | POL-030 | POL-030, PRC-012, PRC-019, POL-014, REF-004 |
| GS-003 | baseline | 100% | 100% | 100% | POL-001 | POL-001, REF-005, REF-003, REF-004, POL-022 |
| GS-003 | graphrag | 100% | 100% | 100% | POL-001 | POL-001, REF-005, REF-003, REF-004, POL-022 |
| GS-004 | baseline | 100% | 100% | 100% | PRC-012 | PRC-012, POL-041, REF-005, POL-014, POL-022 |
| GS-004 | graphrag | 100% | 100% | 100% | PRC-012 | PRC-012, POL-041, REF-005, POL-014, POL-022 |
| GS-005 | baseline | 100% | 100% | 100% | POL-022 | POL-022, PRC-019, INC-2026-031, POL-030, REF-004 |
| GS-005 | graphrag | 100% | 100% | 100% | POL-022 | POL-022, PRC-019, INC-2026-031, POL-030, REF-004 |
| GS-006 | baseline | 100% | 100% | 100% | POL-041 | POL-041, PRC-019, PRC-012, POL-014, POL-022 |
| GS-006 | graphrag | 100% | 100% | 100% | POL-041 | POL-041, PRC-019, PRC-012, POL-014, POL-022 |
| GS-007 | baseline | 100% | 100% | 100% | PRC-007 | POL-022, PRC-007, INC-2026-031, POL-041, MTG-2026-10-14 |
| GS-007 | graphrag | 100% | 100% | 100% | PRC-007 | POL-022, PRC-007, INC-2026-031, POL-041, MTG-2026-10-14 |
| GS-008 | baseline | 100% | 100% | 100% | VND-002 | VND-002, POL-022, REF-004, POL-041, REF-005 |
| GS-008 | graphrag | 100% | 100% | 100% | VND-002 | VND-002, POL-022, REF-004, POL-041, REF-005 |
| GS-018 | baseline | 100% | 100% | 100% | POL-014 | POL-014, POL-030, INC-2026-031, POL-022, POL-001 |
| GS-018 | graphrag | 100% | 100% | 100% | POL-014 | POL-014, POL-030, INC-2026-031, POL-022, POL-001 |
| GS-019 | baseline | — | — | — |  | POL-022, MTG-2026-10-14, INC-2026-031, POL-041, PRC-007 |
| GS-019 | graphrag | — | — | — |  | POL-022, MTG-2026-10-14, INC-2026-031, POL-041, PRC-007 |
| GS-020 | baseline | 100% | 100% | 100% | INC-2026-044 | INC-2026-044, REF-003, REF-004, POL-014, MTG-2026-10-14 |
| GS-020 | graphrag | 100% | 100% | 100% | INC-2026-044 | INC-2026-044, REF-003, REF-004, POL-014, MTG-2026-10-14 |
| **mean** | baseline | 100% | 100% | 100% | | |
| **mean** | graphrag | 100% | 100% | 100% | | |

Only the hybrid arm is gated; `fts` (full-text only) and `vector` (vector only) are diagnostic.
Skipped (—) = no expected sources for that case.
