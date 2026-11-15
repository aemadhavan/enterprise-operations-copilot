"""Print the raw Tier-2 outputs for the hand-check audit cases (docs/evaluation-results.md section 4).

Usage: python scripts/hand_check_audit.py [results.jsonl] [CASE ...]
"""
import json
import sys

DEFAULT_FILE = "evaluation/results/2026-11-14T05-41-22-177Z-2-graphrag.jsonl"
DEFAULT_CASES = ["GS-001", "GS-009", "GS-011", "GS-015", "GS-017", "GS-019",
                 "GS-022", "GS-023", "GS-024", "GS-026", "GS-027", "GS-029"]

path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FILE
cases = sys.argv[2:] or DEFAULT_CASES
rows = {}
with open(path, encoding="utf-8") as fh:
    for line in fh:
        r = json.loads(line)
        if r.get("type") == "case":
            rows[r["case_id"]] = r

for cid in cases:
    r = rows.get(cid)
    print("=" * 80)
    if r is None:
        print(f"{cid}: NOT FOUND in {path}")
        continue
    print(f"case_id={cid} category={r['category']} route_chosen={r['route_chosen']} behaviour={r['behaviour']}")
    print(f"groundedness={r['groundedness']} citation_accuracy={r['citation_accuracy']} completeness={r['completeness']}")
    print("--- answer_markdown[:400] ---")
    print((r.get("answer_markdown") or "")[:400])
    print("--- judge_rationale ---")
    print(r.get("judge_rationale"))
