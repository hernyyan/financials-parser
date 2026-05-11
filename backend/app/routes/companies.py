"""
GET /companies               — List all companies ordered alphabetically.
POST /companies              — Create a new company.
POST /companies/{id}/reprocess-corrections
                             — Developer tool: resets and reruns the AI pipeline for a company.
"""
import json
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import DATA_DIR
from app.db.database import get_db
from app.models.schemas import CompanyCreate, CompanyResponse, ReprocessResponse, ReprocessCorrectionResult
from app.utils.text_utils import markdown_body_word_count

router = APIRouter()

CHANGELOG_PATH = DATA_DIR / "company_context_changelog.jsonl"


def _normalize_company_name(name: str) -> str:
    """Strip to lowercase alphanumeric for fuzzy duplicate detection."""
    return re.sub(r'[^a-z0-9]', '', name.lower())


@router.get("/companies", response_model=list[CompanyResponse])
def list_companies(db: Session = Depends(get_db)):
    """Return all companies ordered alphabetically by name."""
    rows = db.execute(
        text("SELECT id, name FROM companies ORDER BY name ASC")
    ).fetchall()
    return [CompanyResponse(id=row[0], name=row[1]) for row in rows]


@router.post("/companies", response_model=CompanyResponse, status_code=201)
def create_company(request: CompanyCreate, db: Session = Depends(get_db)):
    """Create a new company record."""
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Company name cannot be empty.")

    # Check for exact duplicate
    existing = db.execute(
        text("SELECT id FROM companies WHERE name = :name"),
        {"name": name},
    ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail=f"Company '{name}' already exists.")

    # Check for normalized (fuzzy) duplicate
    normalized_new = _normalize_company_name(name)
    all_rows = db.execute(text("SELECT id, name FROM companies")).fetchall()
    for row in all_rows:
        if _normalize_company_name(row[1]) == normalized_new:
            raise HTTPException(
                status_code=409,
                detail=f"A similar company already exists: '{row[1]}'. "
                       f"If this is a different company, contact an admin.",
            )

    result = db.execute(
        text("INSERT INTO companies (name, context) VALUES (:name, :ctx) RETURNING id"),
        {"name": name, "ctx": f"# {name} — Classification Context\n\n"},
    )
    new_id = result.fetchone()[0]
    db.commit()

    return CompanyResponse(id=new_id, name=name)


@router.get("/companies/{company_id}/context-status")
def get_context_status(company_id: int, db: Session = Depends(get_db)):
    """Check if a company has a context with actual rules."""
    row = db.execute(
        text("SELECT name, context FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Company not found")

    company_name, context = row[0], row[1] or ""
    lines = context.split("\n")
    rule_lines = [l for l in lines if l.strip().startswith("- ")]
    rule_count = len(rule_lines)
    has_rules = rule_count > 0
    wc = markdown_body_word_count(context) if has_rules else 0

    return {
        "company_id": company_id,
        "company_name": company_name,
        "has_rules": has_rules,
        "rule_count": rule_count,
        "word_count": wc,
    }


@router.post("/companies/{company_id}/reprocess-corrections", response_model=ReprocessResponse)
def reprocess_corrections(company_id: int, db: Session = Depends(get_db)):
    """
    Developer endpoint: resets the company's context and changelog entries,
    then reruns the Layer A → Layer B pipeline for all company_specific corrections.
    """
    row = db.execute(
        text("SELECT id, name FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Company {company_id} not found.")

    company_name: str = row[1]

    # Reset context to blank header
    db.execute(
        text("UPDATE companies SET context = :ctx WHERE id = :id"),
        {"ctx": f"# {company_name} — Classification Context\n\n", "id": company_id},
    )

    # Filter this company's entries out of the changelog
    if CHANGELOG_PATH.exists():
        remaining_lines = []
        with CHANGELOG_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if entry.get("company_id") != company_id:
                        remaining_lines.append(line)
                except json.JSONDecodeError:
                    remaining_lines.append(line)
        with CHANGELOG_PATH.open("w", encoding="utf-8") as f:
            for line in remaining_lines:
                f.write(line + "\n")

    # Reset all corrections for this company to unprocessed
    db.execute(
        text(
            "UPDATE company_specific_corrections SET processed = FALSE "
            "WHERE company_id = :company_id"
        ),
        {"company_id": company_id},
    )
    db.commit()

    # Re-run the pipeline for all pending corrections
    from app.services.company_context_service import process_pending_corrections
    raw_results = process_pending_corrections(company_id, db)

    results = [
        ReprocessCorrectionResult(
            correction_id=r.get("correction_id", 0),
            action=r.get("action", "UNKNOWN"),
            detail=r.get("detail", ""),
            layer_a_instruction=r.get("layer_a_instruction"),
        )
        for r in raw_results
    ]

    return ReprocessResponse(
        company_id=company_id,
        company_name=company_name,
        corrections_reprocessed=len(results),
        results=results,
    )
