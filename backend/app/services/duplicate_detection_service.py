"""
Duplicate company detection service.

Owns the scan-and-alert lifecycle for companies whose normalized names
collide (e.g. "Acme Corp" vs "ACME CORP."):

  scan_duplicate_companies(db)
      Compare all company names after normalization. Insert a new
      'duplicate_company_name' alert for every colliding pair not already
      tracked (status 'open' or 'resolved') in context_alerts.

Alert message format: JSON with keys
  company_id_a, company_name_a, company_id_b, company_name_b,
  normalized_name, text

Both IDs are encoded in the message so the existing-pair lookup can
avoid re-querying the DB for every combination. This is acknowledged
as mildly fragile (see tracked_pairs loop below); a future migration
to a dedicated company_id_b column would eliminate the JSON parse.
"""
import json
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.company_service import normalize_company_name

logger = logging.getLogger(__name__)


def scan_duplicate_companies(db: Session) -> None:
    """
    Detect normalized-name collisions among all companies and insert
    new alerts into context_alerts. Idempotent: pairs already tracked
    as 'open' or 'resolved' are skipped.
    Does NOT commit — caller owns the transaction.
    """
    all_companies = db.execute(
        text("SELECT id, name FROM companies ORDER BY id ASC")
    ).fetchall()

    # Group companies by their normalized name to find collisions.
    norm_map: dict[str, list[tuple[int, str]]] = {}
    for cid, cname in all_companies:
        norm = normalize_company_name(cname)
        norm_map.setdefault(norm, []).append((cid, cname))

    # Build the set of all colliding (id_a, id_b) pairs (smaller id first).
    colliding_pairs: set[tuple[int, int]] = set()
    for group in norm_map.values():
        if len(group) < 2:
            continue
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                pair = (min(group[i][0], group[j][0]), max(group[i][0], group[j][0]))
                colliding_pairs.add(pair)

    # Load already-tracked pairs from existing alerts.
    # Both IDs are stored as JSON inside the message field.
    existing_rows = db.execute(
        text("""
            SELECT message, status FROM context_alerts
            WHERE type = 'duplicate_company_name'
        """)
    ).fetchall()

    tracked_pairs: dict[tuple[int, int], str] = {}
    for msg_text, status in existing_rows:
        try:
            data = json.loads(msg_text) if msg_text and msg_text.startswith("{") else {}
            a = data.get("company_id_a", 0)
            b = data.get("company_id_b", 0)
            if a and b:
                tracked_pairs[(min(a, b), max(a, b))] = status
        except Exception:
            continue

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    id_to_name = {cid: cname for cid, cname in all_companies}

    for pair in colliding_pairs:
        if tracked_pairs.get(pair) in ("resolved", "open"):
            continue
        norm = normalize_company_name(id_to_name.get(pair[0], ""))
        msg_data = json.dumps({
            "company_id_a": pair[0],
            "company_name_a": id_to_name.get(pair[0], ""),
            "company_id_b": pair[1],
            "company_name_b": id_to_name.get(pair[1], ""),
            "normalized_name": norm,
            "text": (
                f"Possible duplicate companies: '{id_to_name.get(pair[0], '')}'"
                f" and '{id_to_name.get(pair[1], '')}'."
            ),
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
