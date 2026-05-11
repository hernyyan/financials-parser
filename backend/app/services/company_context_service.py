"""
Company Context Service — public entry points for the correction pipeline.

reset_company_for_reprocessing(company_id, company_name, db)
                               — wipe context + changelog + processed flags
process_correction(correction_id, db)
                               — run pipeline for a single queued correction
process_pending_corrections(company_id, db)
                               — run pipeline for all unprocessed corrections

Both delegate to CorrectionPipeline. These functions exist for backward compatibility
with routes/companies.py (reprocess endpoint) and correction_router.py.
"""
import logging
from typing import List

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.correction_pipeline import get_pipeline, PipelineResult

logger = logging.getLogger(__name__)


def reset_company_for_reprocessing(company_id: int, company_name: str, db: Session) -> None:
    """
    Prepare a company for a full correction reprocess:
      1. Reset context to blank header
      2. Delete this company's changelog entries
      3. Mark all company_specific_corrections as unprocessed

    Caller is responsible for calling db.commit() after this returns.
    """
    db.execute(
        text("UPDATE companies SET context = :ctx WHERE id = :id"),
        {"ctx": f"# {company_name} — Classification Context\n\n", "id": company_id},
    )
    db.execute(
        text("DELETE FROM correction_changelog WHERE company_id = :company_id"),
        {"company_id": company_id},
    )
    db.execute(
        text(
            "UPDATE company_specific_corrections SET processed = FALSE "
            "WHERE company_id = :company_id"
        ),
        {"company_id": company_id},
    )


def process_correction(correction_id: int, db: Session) -> dict:
    """
    Run the Layer A → Layer B pipeline for a single queued correction.
    Returns a summary dict with keys: correction_id, action, detail, layer_a_instruction.
    """
    result: PipelineResult = get_pipeline().process(correction_id, db)
    return {
        "correction_id": result.correction_id,
        "action": result.action,
        "detail": result.detail,
        "layer_a_instruction": result.layer_a_instruction,
    }


def process_pending_corrections(company_id: int, db: Session) -> List[dict]:
    """
    Process all unprocessed company_specific corrections for a company, oldest first.
    Corrections are processed SEQUENTIALLY — each Layer B call depends on the
    current markdown state, which may have just been updated by the previous call.
    """
    rows = db.execute(
        text("""
            SELECT id FROM company_specific_corrections
            WHERE company_id = :company_id AND processed = FALSE
            ORDER BY created_at ASC
        """),
        {"company_id": company_id},
    ).fetchall()

    correction_ids = [row[0] for row in rows]
    results = get_pipeline().process_many(correction_ids, db)

    return [
        {
            "correction_id": r.correction_id,
            "action": r.action,
            "detail": r.detail,
            "layer_a_instruction": r.layer_a_instruction,
        }
        for r in results
    ]
