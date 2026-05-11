"""
Admin endpoints for company management.

GET    /admin/companies                       — List all companies with metadata
GET    /admin/company-data/{company_id}       — Finalized L1/L2 data per period
GET    /admin/company-corrections/{company_id}— All company-specific corrections
PUT    /admin/companies/{company_id}/rename   — Rename a company everywhere
POST   /admin/companies                       — Create a new company
DELETE /admin/companies/{company_id}          — Delete a company and all its data
"""
import shutil
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import COMPANY_DATASETS_DIR
from app.db.database import get_db
from app.models.schemas import AdminRenameCompanyRequest
from app.services.company_service import create_company as _create_company, get_company_or_404, rename_company
from app.utils.json_utils import deserialize_dict
from app.utils.text_utils import markdown_body_word_count

router = APIRouter(prefix="/admin")


@router.get("/companies")
def admin_list_companies(db: Session = Depends(get_db)):
    """List all companies with context metadata and correction counts."""
    rows = db.execute(
        text("""
            SELECT
                c.id,
                c.name,
                c.context,
                COUNT(csc.id) AS total_corrections,
                SUM(CASE WHEN csc.processed THEN 1 ELSE 0 END) AS processed_corrections
            FROM companies c
            LEFT JOIN company_specific_corrections csc ON csc.company_id = c.id
            GROUP BY c.id, c.name, c.context
            ORDER BY c.name ASC
        """)
    ).fetchall()

    results = []
    for row in rows:
        company_id, name, context = row[0], row[1], row[2] or ""
        word_count = markdown_body_word_count(context) if context.strip() else 0
        total = row[3] or 0
        processed = row[4] or 0
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
    _, company_name, _ = get_company_or_404(company_id, db)

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
        {"name": company_name},
    ).fetchall()

    periods = []
    for row in rows:
        periods.append({
            "session_id": row[0],
            "reporting_period": row[1],
            "layer1_data": deserialize_dict(row[2]),
            "layer2_data": deserialize_dict(row[3]),
            "finalized_at": str(row[4]) if row[4] else None,
            "status": row[5],
            "created_at": str(row[6]) if row[6] else None,
        })

    return {"company_id": company_id, "company_name": company_name, "periods": periods}


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

    _, old_name, old_context = get_company_or_404(company_id, db)
    rename_company(company_id, old_name, old_context, new_name, db)
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
    _, company_name, _ = get_company_or_404(company_id, db)

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
