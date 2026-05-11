"""
review_store — owns all reads and writes to the reviews table JSON columns.

Functions:
  merge_layer1_data(db, session_id, sheet_key, data)
      Merge one sheet's Layer 1 result into reviews.layer1_data.

  merge_layer2_data(db, session_id, statement_type, data)
      Merge one statement type's Layer 2 result into reviews.layer2_data.

  upsert_correction(db, session_id, correction_record) -> int
      Find-and-replace a correction by fieldName in reviews.corrections.
      Returns the 1-based index of the upserted entry.

None of these functions commit — the caller decides when to commit.
On DB errors they raise; the caller should rollback and handle.

Design note: both SQLite and Postgres can return the JSON column as either
a native dict/list (Postgres JSONB) or a raw string (SQLite). The shared
helpers in json_utils handle both cases so callers never need to care.
"""
import json
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.utils.json_utils import deserialize_dict, deserialize_list

# Column whitelist guards against SQL injection in _merge_json.
_JSON_COLUMNS = frozenset({"layer1_data", "layer2_data"})


# ── Public API ────────────────────────────────────────────────────────────────

def merge_layer1_data(
    db: Session, session_id: str, sheet_key: str, data: Dict[str, Any]
) -> None:
    """
    Merge one sheet's Layer 1 result into reviews.layer1_data.
    Does not commit.
    """
    _merge_json(db, session_id, "layer1_data", sheet_key, data)


def merge_layer2_data(
    db: Session, session_id: str, statement_type: str, data: Dict[str, Any]
) -> None:
    """
    Merge one statement type's Layer 2 result into reviews.layer2_data.
    Does not commit.
    """
    _merge_json(db, session_id, "layer2_data", statement_type, data)


def upsert_correction(
    db: Session, session_id: str, correction_record: Dict[str, Any]
) -> int:
    """
    Find-and-replace a correction by fieldName in reviews.corrections.
    If no correction with the same fieldName exists, the record is appended.
    Returns the 1-based index of the upserted entry.
    Does not commit.
    """
    row = db.execute(
        text("SELECT corrections FROM reviews WHERE session_id = :sid"),
        {"sid": session_id},
    ).fetchone()
    existing: List[Dict] = deserialize_list(row[0] if row else None)

    found = False
    index = len(existing) + 1
    for i, c in enumerate(existing):
        if c.get("fieldName") == correction_record.get("fieldName"):
            existing[i] = correction_record
            index = i + 1
            found = True
            break
    if not found:
        existing.append(correction_record)

    db.execute(
        text("UPDATE reviews SET corrections = :data WHERE session_id = :sid"),
        {"data": json.dumps(existing), "sid": session_id},
    )
    return index


# ── Internal helpers ─────────────────────────────────────────────────────────

def _merge_json(
    db: Session, session_id: str, column: str, key: str, value: Any
) -> None:
    """Read a JSON dict column, merge one key, and write back. Does not commit."""
    if column not in _JSON_COLUMNS:
        raise ValueError(f"Unknown reviews JSON column: {column!r}")

    row = db.execute(
        text(f"SELECT {column} FROM reviews WHERE session_id = :sid"),  # noqa: S608
        {"sid": session_id},
    ).fetchone()
    existing: Dict[str, Any] = deserialize_dict(row[0] if row else None)
    existing[key] = value
    db.execute(
        text(f"UPDATE reviews SET {column} = :data WHERE session_id = :sid"),  # noqa: S608
        {"data": json.dumps(existing), "sid": session_id},
    )


