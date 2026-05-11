"""
Admin endpoints for company management.

GET    /admin/companies                       — List all companies with metadata
GET    /admin/company-data/{company_id}       — Finalized L1/L2 data per period
GET    /admin/company-corrections/{company_id}— All company-specific corrections
PUT    /admin/companies/{company_id}/rename   — Rename a company everywhere
POST   /admin/companies                       — Create a new company
DELETE /admin/companies/{company_id}          — Delete a company and all its data
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.schemas import AdminRenameCompanyRequest
from app.services.company_service import (
    create_company as _create_company,
    delete_company as _delete_company,
    get_company_or_404,
    get_company_corrections,
    get_company_finalized_data,
    list_companies_with_metadata,
    rename_company,
)

router = APIRouter(prefix="/admin")


@router.get("/companies")
def admin_list_companies(db: Session = Depends(get_db)):
    """List all companies with context metadata and correction counts."""
    return list_companies_with_metadata(db)


@router.get("/company-data/{company_id}")
def admin_company_data(company_id: int, db: Session = Depends(get_db)):
    """Return finalized L1/L2 data for a company — latest load per period, chronological."""
    _, company_name, _ = get_company_or_404(company_id, db)
    return get_company_finalized_data(company_id, company_name, db)


@router.get("/company-corrections/{company_id}")
def admin_company_corrections(company_id: int, db: Session = Depends(get_db)):
    """Return all company_specific_corrections for a company."""
    return get_company_corrections(company_id, db)


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
    _delete_company(company_id, company_name, db)
    return {"success": True, "deleted_company": company_name}
