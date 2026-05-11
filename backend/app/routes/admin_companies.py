"""
Admin endpoints for company management.

GET    /admin/companies                       — List all companies with metadata
GET    /admin/company-data/{company_id}       — Finalized L1/L2 data per period
GET    /admin/company-corrections/{company_id}— All company-specific corrections
PUT    /admin/companies/{company_id}/rename   — Rename a company everywhere
POST   /admin/companies                       — Create a new company
DELETE /admin/companies/{company_id}          — Delete a company and all its data
"""
import json
import shutil
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import COMPANY_DATASETS_DIR
from app.db.database import get_db
from app.models.schemas import AdminRenameCompanyRequest
from app.services.company_service import create_company as _create_company
from app.utils.text_utils import markdown_body_word_count

router = APIRouter(prefix="/admin")


@router.get("/companies")
def admin_list_companies(db: Session = Depends(get_db)):
    """List all companies with context metadata and correction counts."""
    rows = db.execute(
        text("SELECT id, name, context FROM companies ORDER BY name ASC")
    ).fetchall()

    results = []
    for row in rows:
        company_id, name, context = row[0], row[1], row[2] or ""
        word_count = markdown_body_word_count(context) if context.strip() else 0

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
            "context_word_count": word_count,
            "total_corrections": total,
            "processed_corrections": processed,
            "pending_corrections": total - processed,
        })

    return results


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
                   r.finalized_at, r.status, r.created_at
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
            "status": row[5],
            "created_at": str(row[6]) if row[6] else None,
        })

    return {"company_id": company_id, "company_name": company[0], "periods": periods}


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


@router.put("/companies/{company_id}/rename")
def admin_rename_company(
    company_id: int,
    request: AdminRenameCompanyRequest,
    db: Session = Depends(get_db),
):
    """Rename a company everywhere: DB records, datasets directory."""
    new_name = request.name.strip()
    if not new_name:
        raise HTTPException(status_code=422, detail="Name cannot be empty.")

    row = db.execute(
        text("SELECT name, context FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")

    old_name, old_context = row[0], row[1] or ""

    existing = db.execute(
        text("SELECT id FROM companies WHERE LOWER(name) = LOWER(:name) AND id != :id"),
        {"name": new_name, "id": company_id},
    ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail=f"A company named '{new_name}' already exists.")

    # Update context header if present
    new_context = old_context.replace(
        f"# {old_name} — Classification Context",
        f"# {new_name} — Classification Context",
        1,
    )

    # Rename datasets directory if it exists
    old_datasets_dir = COMPANY_DATASETS_DIR / old_name
    new_datasets_dir = COMPANY_DATASETS_DIR / new_name
    if old_datasets_dir.exists() and old_datasets_dir != new_datasets_dir:
        old_datasets_dir.rename(new_datasets_dir)

    db.execute(
        text("UPDATE companies SET name = :name, context = :ctx WHERE id = :id"),
        {"name": new_name, "ctx": new_context, "id": company_id},
    )
    db.execute(
        text("UPDATE reviews SET company_name = :new WHERE company_name = :old"),
        {"new": new_name, "old": old_name},
    )
    db.execute(
        text("UPDATE company_specific_corrections SET company_name = :new WHERE company_name = :old"),
        {"new": new_name, "old": old_name},
    )
    db.commit()

    return {"success": True, "old_name": old_name, "new_name": new_name}


@router.post("/companies", status_code=201)
def admin_create_company(
    request: AdminRenameCompanyRequest,
    db: Session = Depends(get_db),
):
    """Create a new company."""
    new_id, name = _create_company(request.name, db)
    return {"id": new_id, "name": name}


@router.delete("/companies/{company_id}")
def admin_delete_company(company_id: int, db: Session = Depends(get_db)):
    """Delete a company and all its associated data (corrections, datasets)."""
    row = db.execute(
        text("SELECT name FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")

    company_name = row[0]

    db.execute(
        text("DELETE FROM company_specific_corrections WHERE company_id = :id"),
        {"id": company_id},
    )
    db.execute(
        text("DELETE FROM companies WHERE id = :id"),
        {"id": company_id},
    )
    db.commit()

    datasets_dir = COMPANY_DATASETS_DIR / company_name
    if datasets_dir.exists():
        shutil.rmtree(datasets_dir)

    return {"success": True, "deleted_company": company_name}
