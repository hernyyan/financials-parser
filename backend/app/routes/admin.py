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
import shutil
from io import StringIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import COMPANY_CONTEXT_DIR, COMPANY_DATASETS_DIR, DATA_DIR
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
    status_filter: Optional[str] = Query(default="open", alias="status"),
    db: Session = Depends(get_db),
):
    """Return all alerts. Runs duplicate company scan on each call to detect new duplicates."""
    _scan_duplicate_companies(db)

    entries = _read_jsonl(ALERTS_PATH)

    # Migrate old format: boolean 'resolved' → string 'status'
    for e in entries:
        if "resolved" in e and "status" not in e:
            e["status"] = "resolved" if e["resolved"] else "open"

    # Tag each entry with its original file index before filtering/reversing
    for i, e in enumerate(entries):
        e["_file_index"] = i

    if status_filter and status_filter != "all":
        entries = [e for e in entries if e.get("status") == status_filter]

    entries.reverse()

    return {"total_alerts": len(entries), "alerts": entries}


def _scan_duplicate_companies(db: Session) -> None:
    """Detect normalized name collisions among all companies. Append new alerts for untracked pairs."""
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

    existing_alerts = _read_jsonl(ALERTS_PATH)
    tracked_pairs: dict[tuple[int, int], str] = {}
    for alert in existing_alerts:
        if alert.get("type") == "duplicate_company_name":
            a = alert.get("company_id_a", 0)
            b = alert.get("company_id_b", 0)
            pair = (min(a, b), max(a, b))
            tracked_pairs[pair] = alert.get("status", "open")

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    id_to_name = {cid: cname for cid, cname in all_companies}
    new_alerts = []

    for pair in colliding_pairs:
        existing_status = tracked_pairs.get(pair)
        if existing_status in ("resolved", "open"):
            continue
        norm = _normalize_company_name(id_to_name.get(pair[0], ""))
        new_alerts.append({
            "timestamp": timestamp,
            "type": "duplicate_company_name",
            "company_id_a": pair[0],
            "company_name_a": id_to_name.get(pair[0], ""),
            "company_id_b": pair[1],
            "company_name_b": id_to_name.get(pair[1], ""),
            "normalized_name": norm,
            "message": f"Possible duplicate companies: '{id_to_name.get(pair[0], '')}' and '{id_to_name.get(pair[1], '')}'.",
            "status": "open",
        })

    if new_alerts:
        with ALERTS_PATH.open("a", encoding="utf-8") as f:
            for alert in new_alerts:
                f.write(json.dumps(alert) + "\n")


@router.put("/alerts/update-status")
def admin_update_alert_status(request: AlertStatusUpdateRequest):
    """Update the status of an alert by its line index in alerts.jsonl."""
    entries = _read_jsonl(ALERTS_PATH)

    if request.index < 0 or request.index >= len(entries):
        raise HTTPException(status_code=404, detail="Alert index out of range.")

    valid_statuses = {"open", "resolved", "fixed"}
    if request.new_status not in valid_statuses:
        raise HTTPException(status_code=422, detail=f"Status must be one of: {valid_statuses}")

    entries[request.index]["status"] = request.new_status

    with ALERTS_PATH.open("w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")

    return {"success": True, "index": request.index, "new_status": request.new_status}


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


# ── Endpoint 8: PUT /admin/company-context/{company_id} ───────────────────────

from datetime import datetime, timezone
from app.models.schemas import AdminContextUpdateRequest, AdminWriteRuleRequest, AdminRenameCompanyRequest, AlertStatusUpdateRequest
from app.routes.companies import _normalize_company_name, _derive_markdown_filename, _create_markdown_file
from app.services.claude_service import get_claude_service
from app.config import LAYER_A_MODEL, LAYER_B_MODEL

@router.put("/company-context/{company_id}")
def admin_update_company_context(
    company_id: int,
    request: AdminContextUpdateRequest,
    db: Session = Depends(get_db),
):
    """Directly overwrite the company's markdown context file."""
    row = db.execute(
        text("SELECT markdown_filename FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")

    md_path = COMPANY_CONTEXT_DIR / row[0]
    md_path.write_text(request.content, encoding="utf-8")

    return {"success": True, "word_count": len(request.content.split())}


# ── Endpoint 9: POST /admin/write-rule ────────────────────────────────────────

@router.post("/write-rule")
def admin_write_rule(
    request: AdminWriteRuleRequest,
    db: Session = Depends(get_db),
):
    """Submit a rule through Layer A → Layer B pipeline."""
    row = db.execute(
        text("SELECT id, name, markdown_filename FROM companies WHERE id = :company_id"),
        {"company_id": request.company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")

    company_id, company_name, markdown_filename = row

    claude = get_claude_service()
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    layer_a_raw = claude.call_claude(
        prompt_key="layer_a_instruction_rewriter",
        variables={
            "field_name": request.field_name,
            "statement_type": request.statement_type,
            "layer2_value": "N/A (admin-authored rule)",
            "layer2_reasoning": "N/A (admin-authored rule)",
            "corrected_value": "N/A (admin-authored rule)",
            "analyst_reasoning": request.rule_text,
        },
        model=LAYER_A_MODEL,
        max_tokens=2048,
    )
    layer_a_parsed = claude.parse_json_response(layer_a_raw)
    instruction = layer_a_parsed.get("instruction", "")
    referenced_fields = layer_a_parsed.get("referenced_fields", [request.field_name])

    md_path = COMPANY_CONTEXT_DIR / markdown_filename
    current_markdown = md_path.read_text(encoding="utf-8") if md_path.exists() else f"# {company_name} — Classification Context\n\n"

    layer_b_raw = claude.call_claude(
        prompt_key="layer_b_markdown_integrator",
        variables={
            "new_instruction": instruction,
            "referenced_fields": json.dumps(referenced_fields),
            "current_markdown": current_markdown,
        },
        model=LAYER_B_MODEL,
        max_tokens=8192,
    )
    layer_b_parsed = claude.parse_json_response(layer_b_raw)
    action = layer_b_parsed.get("action", "UNKNOWN")
    detail = layer_b_parsed.get("detail", "")
    updated_markdown = layer_b_parsed.get("updated_markdown")

    if updated_markdown and action != "DISCARD":
        md_path.write_text(updated_markdown, encoding="utf-8")

    changelog_entry = {
        "timestamp": timestamp,
        "company_id": company_id,
        "company_name": company_name,
        "source": "admin_portal",
        "field_name": request.field_name,
        "statement_type": request.statement_type,
        "layer_a_instruction": instruction,
        "layer_b_action": action,
        "layer_b_detail": detail,
    }
    changelog_path = DATA_DIR / "company_context_changelog.jsonl"
    with changelog_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(changelog_entry) + "\n")

    return {
        "success": True,
        "layer_a_instruction": instruction,
        "layer_a_referenced_fields": referenced_fields,
        "layer_b_action": action,
        "layer_b_detail": detail,
        "updated_markdown": updated_markdown if action != "DISCARD" else current_markdown,
    }


# ── Endpoint 10: GET /admin/company-data/{company_id} ─────────────────────────

@router.get("/company-data/{company_id}")
def admin_company_data(company_id: int, db: Session = Depends(get_db)):
    """Return finalized L1/L2 data for a company — latest load per period, chronological."""
    company = db.execute(
        text("SELECT name FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")

    rows = db.execute(
        text("""
            SELECT r.session_id, r.reporting_period, r.layer1_data, r.layer2_data,
                   r.finalized_at
            FROM reviews r
            INNER JOIN (
                SELECT reporting_period, MAX(finalized_at) as max_finalized
                FROM reviews
                WHERE company_name = :name AND final_output IS NOT NULL
                GROUP BY reporting_period
            ) latest ON r.reporting_period = latest.reporting_period
                    AND r.finalized_at = latest.max_finalized
            WHERE r.company_name = :name AND r.final_output IS NOT NULL
            ORDER BY r.reporting_period ASC
        """),
        {"name": company[0]},
    ).fetchall()

    periods = []
    for row in rows:
        periods.append({
            "session_id": row[0],
            "reporting_period": row[1],
            "layer1_data": json.loads(row[2]) if isinstance(row[2], str) else row[2],
            "layer2_data": json.loads(row[3]) if isinstance(row[3], str) else row[3],
            "finalized_at": str(row[4]) if row[4] else None,
        })

    return {"company_id": company_id, "company_name": company[0], "periods": periods}


# ── Endpoint 11: GET /admin/company-corrections/{company_id} ──────────────────

@router.get("/company-corrections/{company_id}")
def admin_company_corrections(company_id: int, db: Session = Depends(get_db)):
    """Return all company_specific_corrections for a company."""
    rows = db.execute(
        text("""
            SELECT id, period, statement_type, field_name,
                   layer2_value, corrected_value, analyst_reasoning,
                   processed, created_at
            FROM company_specific_corrections
            WHERE company_id = :company_id
            ORDER BY created_at DESC
        """),
        {"company_id": company_id},
    ).fetchall()

    return {
        "company_id": company_id,
        "corrections": [
            {
                "id": r[0],
                "period": r[1],
                "statement_type": r[2],
                "field_name": r[3],
                "layer2_value": r[4],
                "corrected_value": r[5],
                "analyst_reasoning": r[6],
                "processed": r[7],
                "created_at": str(r[8]) if r[8] else None,
            }
            for r in rows
        ],
    }


# ── Endpoint 12: PUT /admin/companies/{company_id}/rename ─────────────────────

@router.put("/companies/{company_id}/rename")
def admin_rename_company(
    company_id: int,
    request: AdminRenameCompanyRequest,
    db: Session = Depends(get_db),
):
    """Rename a company everywhere: DB, markdown file, datasets directory."""
    new_name = request.name.strip()
    if not new_name:
        raise HTTPException(status_code=422, detail="Name cannot be empty.")

    row = db.execute(
        text("SELECT name, markdown_filename FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")

    old_name, old_md_filename = row[0], row[1]

    # Exact-match duplicate check (exclude self)
    existing = db.execute(
        text("SELECT id FROM companies WHERE LOWER(name) = LOWER(:name) AND id != :id"),
        {"name": new_name, "id": company_id},
    ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail=f"A company named '{new_name}' already exists.")

    new_md_filename = _derive_markdown_filename(new_name)

    # Rename markdown file on disk and update header
    old_md_path = COMPANY_CONTEXT_DIR / old_md_filename
    new_md_path = COMPANY_CONTEXT_DIR / new_md_filename
    if old_md_path.exists():
        content = old_md_path.read_text(encoding="utf-8")
        # Replace first heading line if it matches the old company name pattern
        old_header = f"# {old_name} — Classification Context"
        new_header = f"# {new_name} — Classification Context"
        content = content.replace(old_header, new_header, 1)
        new_md_path.write_text(content, encoding="utf-8")
        if old_md_path != new_md_path:
            old_md_path.unlink()

    # Rename datasets directory on disk
    old_datasets_dir = COMPANY_DATASETS_DIR / old_name
    new_datasets_dir = COMPANY_DATASETS_DIR / new_name
    if old_datasets_dir.exists() and old_datasets_dir != new_datasets_dir:
        old_datasets_dir.rename(new_datasets_dir)

    # Update DB: companies table
    db.execute(
        text("UPDATE companies SET name = :name, markdown_filename = :md WHERE id = :id"),
        {"name": new_name, "md": new_md_filename, "id": company_id},
    )

    # Update DB: reviews table
    db.execute(
        text("UPDATE reviews SET company_name = :new WHERE company_name = :old"),
        {"new": new_name, "old": old_name},
    )

    # Update DB: company_specific_corrections table
    db.execute(
        text("UPDATE company_specific_corrections SET company_name = :new WHERE company_name = :old"),
        {"new": new_name, "old": old_name},
    )

    db.commit()

    return {"success": True, "old_name": old_name, "new_name": new_name}


# ── Endpoint 13: POST /admin/companies ────────────────────────────────────────

@router.post("/companies", status_code=201)
def admin_create_company(
    request: AdminRenameCompanyRequest,
    db: Session = Depends(get_db),
):
    """Create a new company with a blank markdown context file."""
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty.")

    # Exact duplicate check
    existing_exact = db.execute(
        text("SELECT id FROM companies WHERE LOWER(name) = LOWER(:name)"),
        {"name": name},
    ).fetchone()
    if existing_exact:
        raise HTTPException(status_code=409, detail=f"Company '{name}' already exists.")

    # Normalized fuzzy duplicate check
    name_normalized = _normalize_company_name(name)
    all_names = db.execute(text("SELECT id, name FROM companies")).fetchall()
    for existing_id, existing_name in all_names:
        if _normalize_company_name(existing_name) == name_normalized:
            raise HTTPException(
                status_code=409,
                detail=f"A similar company already exists: '{existing_name}'.",
            )

    md_filename = _derive_markdown_filename(name)

    result = db.execute(
        text(
            "INSERT INTO companies (name, markdown_filename) VALUES (:name, :md) RETURNING id"
        ),
        {"name": name, "md": md_filename},
    )
    new_id = result.fetchone()[0]
    db.commit()

    _create_markdown_file(name, md_filename)

    return {"id": new_id, "name": name, "markdown_filename": md_filename}


# ── Endpoint 14: DELETE /admin/companies/{company_id} ─────────────────────────

@router.delete("/companies/{company_id}")
def admin_delete_company(company_id: int, db: Session = Depends(get_db)):
    """Delete a company and all its associated data (corrections, context file, datasets)."""
    row = db.execute(
        text("SELECT name, markdown_filename FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")

    company_name, md_filename = row[0], row[1]

    # Delete corrections
    db.execute(
        text("DELETE FROM company_specific_corrections WHERE company_id = :id"),
        {"id": company_id},
    )

    # Delete company row
    db.execute(
        text("DELETE FROM companies WHERE id = :id"),
        {"id": company_id},
    )

    db.commit()

    # Delete markdown file
    if md_filename:
        md_path = COMPANY_CONTEXT_DIR / md_filename
        if md_path.exists():
            md_path.unlink()

    # Delete datasets directory
    datasets_dir = COMPANY_DATASETS_DIR / company_name
    if datasets_dir.exists():
        shutil.rmtree(datasets_dir)

    return {"success": True, "deleted_company": company_name}
