"""
Shared helpers for admin route modules.
"""
import json
from typing import List

from app.config import DATA_DIR

GENERAL_FIXES_PATH = DATA_DIR / "general_fixes.csv"


def read_jsonl(path) -> List[dict]:
    """Read a JSONL file and return a list of parsed objects, skipping bad lines."""
    if not path.exists():
        return []
    entries = []
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return []
    return entries


def scan_duplicate_companies(db) -> None:
    """Detect normalized name collisions among all companies. Insert new alerts into DB."""
    from datetime import datetime, timezone
    from sqlalchemy import text
    from app.routes.companies import _normalize_company_name

    all_companies = db.execute(
        text("SELECT id, name FROM companies ORDER BY id ASC")
    ).fetchall()

    norm_map: dict[str, list[tuple[int, str]]] = {}
    for cid, cname in all_companies:
        norm = _normalize_company_name(cname)
        norm_map.setdefault(norm, []).append((cid, cname))

    colliding_pairs: set[tuple[int, int]] = set()
    for group in norm_map.values():
        if len(group) < 2:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                pair = (min(group[i][0], group[j][0]), max(group[i][0], group[j][0]))
                colliding_pairs.add(pair)

    # Load tracked pairs from DB to avoid inserting duplicates
    existing_rows = db.execute(
        text("""
            SELECT message, status FROM context_alerts
            WHERE type = 'duplicate_company_name'
        """)
    ).fetchall()

    # Extract company_id pairs from message text is fragile; use a dedicated lookup.
    # Instead, query by company_id stored in company_name field (we encode both IDs in message).
    # Simpler: re-check by scanning existing alerts for this pair via company_id columns.
    # For duplicate alerts we store company_id_a and company_id_b in the message as JSON.
    tracked_pairs: dict[tuple[int, int], str] = {}
    for msg_text, status in existing_rows:
        try:
            data = json.loads(msg_text) if msg_text and msg_text.startswith("{") else {}
            a = data.get("company_id_a", 0)
            b = data.get("company_id_b", 0)
            if a and b:
                pair = (min(a, b), max(a, b))
                tracked_pairs[pair] = status
        except Exception:
            continue

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    id_to_name = {cid: cname for cid, cname in all_companies}

    for pair in colliding_pairs:
        existing_status = tracked_pairs.get(pair)
        if existing_status in ("resolved", "open"):
            continue
        norm = _normalize_company_name(id_to_name.get(pair[0], ""))
        # Encode pair IDs in message as JSON so we can re-parse them above.
        msg_data = json.dumps({
            "company_id_a": pair[0],
            "company_name_a": id_to_name.get(pair[0], ""),
            "company_id_b": pair[1],
            "company_name_b": id_to_name.get(pair[1], ""),
            "normalized_name": norm,
            "text": f"Possible duplicate companies: '{id_to_name.get(pair[0], '')}' and '{id_to_name.get(pair[1], '')}'.",
        })
        db.execute(
            text("""
                INSERT INTO context_alerts
                    (timestamp, type, company_id, company_name, message, status)
                VALUES
                    (:ts, 'duplicate_company_name', :cid, :cn, :msg, 'open')
            """),
            {
                "ts": timestamp,
                "cid": pair[0],
                "cn": id_to_name.get(pair[0], ""),
                "msg": msg_data,
            },
        )
    db.commit()
