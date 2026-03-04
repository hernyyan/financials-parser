"""
GET /admin/companies                    — List all companies with markdown and corrections metadata.
GET /admin/company-context/{company_id} — Full contents of a company's markdown context file.
GET /admin/changelog                    — Entries from company_context_changelog.jsonl.
GET /admin/alerts                       — Entries from alerts.jsonl.
GET /admin/general-fixes                — Rows from general_fixes.csv.
GET /admin/reviews                      — List all reviews (newest first) with optional filters.
GET /admin/reviews/{session_id}/export  — Download finalized output as a CSV file.
"""
import csv
import json
import re
from io import StringIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import COMPANY_CONTEXT_DIR, DATA_DIR
from app.db.database import get_db
from app.services.template_service import get_template_service

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


# ── Endpoint 6: GET /admin/reviews ────────────────────────────────────────────

@router.get("/reviews")
def admin_list_reviews(
    status: Optional[str] = Query(default=None, description="Filter by status: 'finalized' or 'in_progress'"),
    company: Optional[str] = Query(default=None, description="Case-insensitive partial match on company name"),
    limit: int = Query(default=50, ge=1),
    db: Session = Depends(get_db),
):
    """List all reviews newest first, with optional status and company filters."""
    conditions: list[str] = []
    params: dict = {}

    if status:
        conditions.append("status = :status")
        params["status"] = status
    if company:
        conditions.append("LOWER(company_name) LIKE :company")
        params["company"] = f"%{company.lower()}%"

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total: int = db.execute(
        text(f"SELECT COUNT(*) FROM reviews {where_clause}"),
        params,
    ).scalar() or 0

    rows = db.execute(
        text(f"""
            SELECT id, session_id, company_name, reporting_period, status,
                   created_at, finalized_at, corrections
            FROM reviews
            {where_clause}
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        {**params, "limit": limit},
    ).fetchall()

    reviews = []
    for row in rows:
        corrections_raw = row[7]
        try:
            corrections_list = (
                json.loads(corrections_raw)
                if isinstance(corrections_raw, str)
                else (corrections_raw or [])
            )
            corrections_count = len(corrections_list) if isinstance(corrections_list, list) else 0
        except (json.JSONDecodeError, TypeError):
            corrections_count = 0

        reviews.append({
            "id": row[0],
            "session_id": row[1],
            "company_name": row[2],
            "reporting_period": row[3],
            "status": row[4],
            "created_at": row[5],
            "finalized_at": row[6],
            "corrections_count": corrections_count,
        })

    return {"total": total, "reviews": reviews}


# ── Endpoint 7: GET /admin/reviews/{session_id}/export ────────────────────────

@router.get("/reviews/{session_id}/export")
def admin_export_review(session_id: str, db: Session = Depends(get_db)):
    """Download the finalized output for a review as a CSV file attachment."""
    row = db.execute(
        text("""
            SELECT company_name, reporting_period, final_output, corrections
            FROM reviews WHERE session_id = :sid
        """),
        {"sid": session_id},
    ).fetchone()

    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Session '{session_id}' not found or not yet finalized.",
        )

    company_name: str = row[0]
    reporting_period: str = row[1]
    final_output: dict = json.loads(row[2] or "{}")
    corrections: list = json.loads(row[3] or "[]")
    corrected_fields = {c.get("fieldName", "") for c in corrections}

    template_svc = get_template_service()

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Field Name", "Value", "Status"])

    for stmt_label, stmt_key in [
        ("Income Statement", "income_statement"),
        ("Balance Sheet", "balance_sheet"),
    ]:
        writer.writerow([stmt_label, "", ""])
        sections = template_svc.template.get(stmt_key, {}).get("sections", [])
        stmt_values: dict = final_output.get(stmt_label, {})

        for section in sections:
            header = section.get("header")
            if header:
                writer.writerow([header, "", ""])
            for field in section.get("fields", []):
                value = stmt_values.get(field)
                value_str = f"{value:.2f}" if value is not None else ""
                status = "corrected" if field in corrected_fields else ""
                writer.writerow([field, value_str, status])

        writer.writerow(["", "", ""])

    safe_company = re.sub(r"[^\w\s-]", "", company_name).strip().replace(" ", "_")
    safe_period = re.sub(r"[^\w\s-]", "", reporting_period).strip().replace(" ", "_")
    filename = f"{safe_company}_{safe_period}.csv"

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
