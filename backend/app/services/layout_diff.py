"""
LCS-based layout diff for detecting structural changes between uploaded Excel sheets.

diff_layouts() compares two ordered lists of {row_index, label} dicts using
Longest Common Subsequence on normalized label strings — the same approach git
uses for file diffs.

Change categories:
  - "rename"  : same sequence position, different label after normalization
  - "add"     : row present in new layout only
  - "remove"  : row present in old layout only

Silent changes (no user action required — handled automatically):
  - Blank rows added or removed when no real structural changes exist
  - Labels that differ only in whitespace or capitalisation

Row mapping:
  - When blank rows shift non-blank rows, diff_layouts() returns a row_mapping
    dict {old_row_index: new_row_index} covering only rows whose number changed.
  - In a pure silent update, the backend uses this to remap L1 template source_rows.
  - In a mixed update (blank shifts + real changes), blank rows are NOT marked
    silent so they appear in the reconcile editor, and row_mapping is returned
    for the frontend to pre-correct the template before opening the editor.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


# ── Normalisation ─────────────────────────────────────────────────────────────

def _normalize(label: str) -> str:
    """Lowercase and collapse whitespace. Used for comparison only."""
    return re.sub(r"\s+", " ", label.strip().lower())


def _is_blank(label: str) -> bool:
    return label.strip() == ""


def _is_silent_change(old_label: str, new_label: str) -> bool:
    """True if the only difference is whitespace or capitalisation."""
    return _normalize(old_label) == _normalize(new_label)


# ── LCS ───────────────────────────────────────────────────────────────────────

def _lcs_table(old: List[str], new: List[str]) -> List[List[int]]:
    """Build the LCS length table. O(m*n) time and space."""
    m, n = len(old), len(new)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if old[i - 1] == new[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp


def _backtrack(
    dp: List[List[int]],
    old: List[str],
    new: List[str],
    i: int,
    j: int,
) -> List[Dict[str, Any]]:
    """
    Backtrack the LCS table and emit diff operations.
    Returns list of {op, old_idx, new_idx} where op is 'keep'|'add'|'remove'.
    Keep ops are included so the caller can derive the row_mapping.
    """
    ops: List[Dict[str, Any]] = []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and old[i - 1] == new[j - 1]:
            ops.append({"op": "keep", "old_idx": i - 1, "new_idx": j - 1})
            i -= 1
            j -= 1
        elif j > 0 and (i == 0 or dp[i][j - 1] >= dp[i - 1][j]):
            ops.append({"op": "add", "old_idx": None, "new_idx": j - 1})
            j -= 1
        else:
            ops.append({"op": "remove", "old_idx": i - 1, "new_idx": None})
            i -= 1
    ops.reverse()
    return ops


# ── Public API ────────────────────────────────────────────────────────────────

def diff_layouts(
    old_rows: List[Dict[str, Any]],
    new_rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Compare two layout row lists via LCS on normalized labels.

    Each row is: { "row_index": int, "label": str, ... }

    Returns:
    {
      "has_real_diff": bool,         # True if any non-silent changes exist
      "silent_update": bool,         # True if only silent changes (auto-accept)
      "changes": [...],              # all change entries
      "row_mapping": {int: int},     # old_row_index -> new_row_index (shifted rows only)
    }
    """
    old_norms = [_normalize(r["label"]) for r in old_rows]
    new_norms = [_normalize(r["label"]) for r in new_rows]

    dp = _lcs_table(old_norms, new_norms)
    ops = _backtrack(dp, old_norms, new_norms, len(old_norms), len(new_norms))

    # Build row_mapping from "keep" ops where the row_index actually changed
    # (i.e., blank rows were inserted/removed above this row, shifting it)
    row_mapping: Dict[int, int] = {}
    for op in ops:
        if op["op"] == "keep":
            old_row_num = old_rows[op["old_idx"]]["row_index"]
            new_row_num = new_rows[op["new_idx"]]["row_index"]
            if old_row_num != new_row_num:
                row_mapping[old_row_num] = new_row_num

    # Pair up adjacent remove+add ops as potential renames
    changes: List[Dict[str, Any]] = []
    i = 0
    while i < len(ops):
        op = ops[i]
        if op["op"] == "keep":
            i += 1
            continue

        # Check for a remove immediately followed by an add → rename candidate
        if (
            op["op"] == "remove"
            and i + 1 < len(ops)
            and ops[i + 1]["op"] == "add"
        ):
            old_row = old_rows[op["old_idx"]]
            new_row = new_rows[ops[i + 1]["new_idx"]]
            silent = _is_silent_change(old_row["label"], new_row["label"]) or (
                _is_blank(old_row["label"]) and _is_blank(new_row["label"])
            )
            changes.append({
                "type": "rename",
                "old": old_row,
                "new": new_row,
                "silent": silent,
            })
            i += 2
            continue

        if op["op"] == "remove":
            old_row = old_rows[op["old_idx"]]
            silent = _is_blank(old_row["label"])
            changes.append({"type": "remove", "old": old_row, "new": None, "silent": silent})
        elif op["op"] == "add":
            new_row = new_rows[op["new_idx"]]
            silent = _is_blank(new_row["label"])
            changes.append({"type": "add", "old": None, "new": new_row, "silent": silent})

        i += 1

    # In a mixed update (real structural changes + blank row shifts), make blank
    # changes visible too so they appear in the reconcile editor.
    has_any_real = any(not c["silent"] for c in changes)
    if has_any_real:
        for c in changes:
            if c["silent"]:
                old_lbl = (c.get("old") or {}).get("label", "")
                new_lbl = (c.get("new") or {}).get("label", "")
                if _is_blank(old_lbl) or _is_blank(new_lbl):
                    c["silent"] = False

    has_real_diff = any(not c["silent"] for c in changes)
    silent_update = bool(changes) and not has_real_diff

    return {
        "has_real_diff": has_real_diff,
        "silent_update": silent_update,
        "changes": changes,
        "row_mapping": row_mapping,
    }
