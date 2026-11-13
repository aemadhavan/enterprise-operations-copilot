#!/usr/bin/env python3
"""Consistency checks for the synthetic knowledge base, graph seed and golden set.

Run from the repo root:  python scripts/validate_seed.py
Exits non-zero on any error, so it can run in CI before the evals.
"""
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
SEED = ROOT / "data" / "graph_seed"
GOLDEN = ROOT / "evaluation" / "golden_set.jsonl"

REQUIRED_META = ["doc_id", "title", "doc_type", "version", "effective_date", "owner", "classification", "source_system", "synthetic"]
ROUTES = {"text", "graph_local", "graph_traversal", "action", "refuse", "clarify"}
BEHAVIOURS = {"answer", "state_gap", "draft_and_await_approval", "flag_and_propose", "refuse", "clarify"}
TOOLS = {None, "create_access_request", "create_onboarding_ticket"}

errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


# 1. Documents
doc_ids = set()
for path in sorted(RAW.glob("*.md")):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        err(f"{path.name}: missing frontmatter")
        continue
    meta = dict(line.split(":", 1) for line in m.group(1).splitlines() if ":" in line)
    meta = {k.strip(): v.strip().strip('"') for k, v in meta.items()}
    for key in REQUIRED_META:
        if key not in meta:
            err(f"{path.name}: missing '{key}'")
    if meta.get("synthetic") != "true":
        err(f"{path.name}: synthetic must be true")
    if "SYNTHETIC DOCUMENT" not in text:
        err(f"{path.name}: missing synthetic banner")
    doc_ids.add(meta.get("doc_id"))

# 2. Graph
with open(SEED / "nodes.csv", newline="", encoding="utf-8") as f:
    nodes = list(csv.DictReader(f))
node_ids = Counter(n["id"] for n in nodes)
for nid, c in node_ids.items():
    if c > 1:
        err(f"nodes.csv: duplicate id {nid}")
for n in nodes:
    if n["source_doc"] not in doc_ids:
        err(f"nodes.csv: {n['id']} cites unknown doc {n['source_doc']}")

with open(SEED / "edges.csv", newline="", encoding="utf-8") as f:
    edges = list(csv.DictReader(f))
for i, e in enumerate(edges, start=2):
    for end in ("source", "target"):
        if e[end] not in node_ids:
            err(f"edges.csv line {i}: unknown {end} {e[end]}")
    if e["source_doc"] not in doc_ids:
        err(f"edges.csv line {i}: unknown source_doc {e['source_doc']}")

# Highest classification of each system must equal the max over its 'stores' edges (POL-001 §3)
rank = {"Internal": 1, "Confidential": 2, "Restricted": 3}
cls = {n["id"]: n["classification"] for n in nodes}
for n in nodes:
    if n["label"] != "System":
        continue
    stored = [cls[e["target"]] for e in edges if e["source"] == n["id"] and e["relation"] == "stores"]
    if not stored:
        err(f"{n['id']}: stores no data class")
        continue
    expected = max(stored, key=rank.get)
    if n["classification"] != expected:
        err(f"{n['id']}: classification {n['classification']} but stores imply {expected}")

# Every system needs exactly one data owner
for n in nodes:
    if n["label"] == "System":
        owners = [e for e in edges if e["source"] == n["id"] and e["relation"] == "data_owner"]
        if len(owners) != 1:
            err(f"{n['id']}: expected 1 data_owner edge, found {len(owners)}")

# 3. Golden set
cases = []
for i, line in enumerate(GOLDEN.read_text(encoding="utf-8").splitlines(), start=1):
    if not line.strip():
        continue
    try:
        cases.append(json.loads(line))
    except json.JSONDecodeError as ex:
        err(f"golden_set line {i}: invalid JSON ({ex})")
ids = Counter(c["id"] for c in cases)
for cid, c in ids.items():
    if c > 1:
        err(f"golden_set: duplicate id {cid}")
for c in cases:
    cid = c["id"]
    if c["expected_route"] not in ROUTES:
        err(f"{cid}: bad route {c['expected_route']}")
    if c["expected_behaviour"] not in BEHAVIOURS:
        err(f"{cid}: bad behaviour {c['expected_behaviour']}")
    if c["expected_tool"] not in TOOLS:
        err(f"{cid}: unknown tool {c['expected_tool']}")
    for s in c["expected_sources"]:
        if s not in doc_ids:
            err(f"{cid}: unknown source {s}")
    if c["expected_tool"] and not c["requires_approval"]:
        err(f"{cid}: write tool without requires_approval (Constitution II)")
    if c["expected_behaviour"] == "answer" and not c["expected_sources"]:
        err(f"{cid}: answer case with no expected sources (Constitution I)")

# Report
print(f"Documents:   {len(doc_ids)}")
print(f"Graph:       {len(nodes)} nodes, {len(edges)} edges")
print(f"Node labels: {dict(Counter(n['label'] for n in nodes))}")
print(f"Golden set:  {len(cases)} cases {dict(Counter(c['category'] for c in cases))}")
if errors:
    print(f"\n{len(errors)} error(s):")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("\nAll checks passed.")
