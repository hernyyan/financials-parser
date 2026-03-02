"""
GET /admin/companies                    — List all companies with markdown and corrections metadata.
GET /admin/company-context/{company_id} — Full contents of a company's markdown context file.
GET /admin/changelog                    — Entries from company_context_changelog.jsonl.
GET /admin/alerts                       — Entries from alerts.jsonl.
GET /admin/general-fixes                — Rows from general_fixes.csv.
"""
import csv
import json
from io import StringIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import COMPANY_CONTEXT_DIR, DATA_DIR
from app.db.database import get_db

router = APIRouter(prefix="/admin")

CHANGELOG_PATH = DATA_DIR / "company_context_changelog.jsonl"
ALERTS_PATH = DATA_DIR / "alerts.jsonl"
GENERAL_FIXES_PATH = DATA_DIR / "general_fixes.csv"


# ── Endpoint 1: GET /admin/companies ──────────────────────────────────────────

@router.get("/companies")
def admin_list_companies(db: Session = Depends(get_db)):
    """List all companies with markdown file metadata and correction counts."""
    rows = db.execute(
        text("SELECT id, name, markdown_filename FROM companies ORDER BY name ASC")
    ).fetchall()

    results = []
    for row in rows:
        company_id, name, markdown_filename = row[0], row[1], row[2]

        # Markdown file stats
        word_count = 0
        file_size_bytes = 0
        if markdown_filename:
            path = COMPANY_CONTEXT_DIR / markdown_filename
            if path.exists():
                content = path.read_text(encoding="utf-8")
                word_count = len(content.split())
                file_size_bytes = path.stat().st_size

        # Correction counts
        counts = db.execute(
            text("""
                SELECT COUNT(*) AS total,
                       SUM(CASE WHEN processed THEN 1 ELSE 0 END) AS processed
                FROM company_specific_corrections
                WHERE company_id = :company_id
            """),
            {"company_id": company_id},
        ).fetchone()
        total = counts[0] or 0
        processed = counts[1] or 0

        results.append({
            "id": company_id,
            "name": name,
            "markdown_filename": markdown_filename,
            "markdown_word_count": word_count,
            "markdown_file_size_bytes": file_size_bytes,
            "total_corrections": total,
            "processed_corrections": processed,
            "pending_corrections": total - processed,
        })

    return results


# ── Endpoint 2: GET /admin/company-context/{company_id} ───────────────────────

@router.get("/company-context/{company_id}")
def admin_company_context(company_id: int, db: Session = Depends(get_db)):
    """Return the full contents of a company's markdown context file."""
    row = db.execute(
        text("SELECT id, name, markdown_filename FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Company {company_id} not found.")

    name = row[1]
    markdown_filename = row[2]

    content = None
    word_count = 0
    if markdown_filename:
        path = COMPANY_CONTEXT_DIR / markdown_filename
        if path.exists():
            content = path.read_text(encoding="utf-8")
            word_count = len(content.split())

    return {
        "id": company_id,
        "name": name,
        "markdown_filename": markdown_filename,
        "word_count": word_count,
        "content": content,
    }


# ── Endpoint 3: GET /admin/changelog ──────────────────────────────────────────

@router.get("/changelog")
def admin_changelog(
    company_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1),
):
    """Return entries from company_context_changelog.jsonl, newest first."""
    entries = _read_jsonl(CHANGELOG_PATH)

    if company_id is not None:
        entries = [e for e in entries if e.get("company_id") == company_id]

    entries.reverse()
    entries = entries[:limit]

    return {"total_entries": len(entries), "entries": entries}


# ── Endpoint 4: GET /admin/alerts ─────────────────────────────────────────────

@router.get("/alerts")
def admin_alerts(
    resolved: Optional[bool] = Query(default=False),
):
    """Return entries from alerts.jsonl, newest first. Filters by resolved status."""
    entries = _read_jsonl(ALERTS_PATH)

    if resolved is not None:
        entries = [e for e in entries if e.get("resolved") == resolved]

    entries.reverse()

    return {"total_alerts": len(entries), "alerts": entries}


# ── Endpoint 5: GET /admin/general-fixes ──────────────────────────────────────

@router.get("/general-fixes")
def admin_general_fixes(
    limit: int = Query(default=50, ge=1),
    company: Optional[str] = Query(default=None),
):
    """Return rows from general_fixes.csv, newest first."""
    if not GENERAL_FIXES_PATH.exists():
        return {"total_entries": 0, "entries": []}

    try:
        text_content = GENERAL_FIXES_PATH.read_text(encoding="utf-8")
    except OSError:
        return {"total_entries": 0, "entries": []}

    rows = []
    reader = csv.DictReader(StringIO(text_content))
    for row in reader:
        try:
            rows.append(dict(row))
        except Exception:
            continue  # Skip malformed rows

    if company:
        company_lower = company.lower()
        rows = [r for r in rows if company_lower in (r.get("company") or "").lower()]

    rows.reverse()
    rows = rows[:limit]

    return {"total_entries": len(rows), "entries": rows}


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _read_jsonl(path) -> list:
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
