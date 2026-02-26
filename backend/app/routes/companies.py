"""
GET /companies               — List all companies ordered alphabetically.
POST /companies              — Create a new company and its blank markdown context file.
POST /companies/{id}/reprocess-corrections
                             — Developer tool: resets and reruns the AI pipeline for a company.
"""
import json
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import COMPANY_CONTEXT_DIR, DATA_DIR
from app.db.database import get_db
from app.models.schemas import CompanyCreate, CompanyResponse, ReprocessResponse, ReprocessCorrectionResult

router = APIRouter()

CHANGELOG_PATH = DATA_DIR / "company_context_changelog.jsonl"


def _derive_markdown_filename(company_name: str) -> str:
    """Convert company name to a safe markdown filename.
    e.g. 'Acme Corp & Sons' → 'acme_corp__sons.md'
    """
    lower = company_name.lower()
    underscored = lower.replace(" ", "_")
    cleaned = re.sub(r"[^a-z0-9_]", "", underscored)
    return f"{cleaned}.md"


def _create_markdown_file(company_name: str, filename: str) -> None:
    """Create a blank markdown context file for the company."""
    path = COMPANY_CONTEXT_DIR / filename
    if not path.exists():
        path.write_text(
            f"# {company_name} — Classification Context\n\n",
            encoding="utf-8",
        )


@router.get("/companies", response_model=list[CompanyResponse])
def list_companies(db: Session = Depends(get_db)):
    """Return all companies ordered alphabetically by name."""
    rows = db.execute(
        text("SELECT id, name, markdown_filename FROM companies ORDER BY name ASC")
    ).fetchall()
    return [
        CompanyResponse(id=row[0], name=row[1], markdown_filename=row[2])
        for row in rows
    ]


@router.post("/companies", response_model=CompanyResponse, status_code=201)
def create_company(request: CompanyCreate, db: Session = Depends(get_db)):
    """Create a new company record and its blank markdown context file."""
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Company name cannot be empty.")

    markdown_filename = _derive_markdown_filename(name)

    # Check for duplicate
    existing = db.execute(
        text("SELECT id FROM companies WHERE name = :name"),
        {"name": name},
    ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail=f"Company '{name}' already exists.")

    result = db.execute(
        text(
            "INSERT INTO companies (name, markdown_filename) "
            "VALUES (:name, :filename) RETURNING id"
        ),
        {"name": name, "filename": markdown_filename},
    )
    new_id = result.fetchone()[0]
    db.commit()

    _create_markdown_file(name, markdown_filename)

    return CompanyResponse(id=new_id, name=name, markdown_filename=markdown_filename)


@router.post("/companies/{company_id}/reprocess-corrections", response_model=ReprocessResponse)
def reprocess_corrections(company_id: int, db: Session = Depends(get_db)):
    """
    Developer endpoint: resets the company's markdown context file and changelog entries,
    then reruns the Layer A → Layer B pipeline for all company_specific corrections.

    Useful when prompts have been updated and you want to regenerate the context file.
    """
    # 1. Look up company
    row = db.execute(
        text("SELECT id, name, markdown_filename FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Company {company_id} not found.")

    company_name: str = row[1]
    markdown_filename: str = row[2]

    # 2. Reset the markdown file to blank header
    markdown_path = COMPANY_CONTEXT_DIR / markdown_filename
    markdown_path.write_text(
        f"# {company_name} — Classification Context\n\n",
        encoding="utf-8",
    )

    # 3. Filter this company's entries out of the changelog
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
                    remaining_lines.append(line)  # Preserve malformed lines as-is
        with CHANGELOG_PATH.open("w", encoding="utf-8") as f:
            for line in remaining_lines:
                f.write(line + "\n")

    # 4. Reset all corrections for this company to unprocessed
    db.execute(
        text(
            "UPDATE company_specific_corrections SET processed = FALSE "
            "WHERE company_id = :company_id"
        ),
        {"company_id": company_id},
    )
    db.commit()

    # 5. Re-run the pipeline for all pending corrections
    from app.services.company_context_service import process_pending_corrections
    raw_results = process_pending_corrections(company_id, db)

    # 6. Build the response
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
