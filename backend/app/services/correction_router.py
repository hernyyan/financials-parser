"""
Correction routing service.

Routes analyst corrections by tag:
  - one_off_error:    No side effects beyond updating output values.
  - general_fix:      Append a row to backend/data/general_fixes.csv.
  - company_specific: Queue in company_specific_corrections table, then run
                      the Layer A → Layer B AI pipeline inline.
"""
import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import DATA_DIR
from app.models.schemas import CorrectionProcessItem, CorrectionProcessResponse

GENERAL_FIXES_CSV = DATA_DIR / "general_fixes.csv"

CSV_FIELDNAMES = [
    "timestamp",
    "company",
    "period",
    "statement_type",
    "field_name",
    "layer2_value",
    "layer2_reasoning",
    "layer2_validation",
    "corrected_value",
    "difference",
    "analyst_reasoning",
]


def _append_general_fix_csv(
    company_name: str,
    period: str,
    item: CorrectionProcessItem,
    timestamp: str,
) -> None:
    """Append one row to the general fixes CSV, creating the file with headers if needed."""
    file_exists = GENERAL_FIXES_CSV.exists()
    with GENERAL_FIXES_CSV.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=CSV_FIELDNAMES,
            quoting=csv.QUOTE_ALL,
        )
        if not file_exists:
            writer.writeheader()
        difference = (
            (item.corrected_value - item.layer2_value)
            if item.layer2_value is not None
            else None
        )
        writer.writerow(
            {
                "timestamp": timestamp,
                "company": company_name,
                "period": period,
                "statement_type": item.statement_type,
                "field_name": item.field_name,
                "layer2_value": item.layer2_value,
                "layer2_reasoning": item.layer2_reasoning or "",
                "layer2_validation": item.layer2_validation or "",
                "corrected_value": item.corrected_value,
                "difference": difference,
                "analyst_reasoning": item.analyst_reasoning or "",
            }
        )


def _queue_company_specific(
    db: Session,
    company_id: int,
    company_name: str,
    period: str,
    item: CorrectionProcessItem,
) -> int:
    """Insert a company-specific correction into the queue table. Returns the new row ID."""
    result = db.execute(
        text(
            """
            INSERT INTO company_specific_corrections
                (company_id, company_name, period, statement_type, field_name,
                 layer2_value, layer2_reasoning, layer2_validation,
                 corrected_value, analyst_reasoning, processed)
            VALUES
                (:company_id, :company_name, :period, :statement_type, :field_name,
                 :layer2_value, :layer2_reasoning, :layer2_validation,
                 :corrected_value, :analyst_reasoning, FALSE)
            RETURNING id
            """
        ),
        {
            "company_id": company_id,
            "company_name": company_name,
            "period": period,
            "statement_type": item.statement_type,
            "field_name": item.field_name,
            "layer2_value": item.layer2_value,
            "layer2_reasoning": item.layer2_reasoning,
            "layer2_validation": item.layer2_validation,
            "corrected_value": item.corrected_value,
            "analyst_reasoning": item.analyst_reasoning,
        },
    )
    return result.fetchone()[0]


def process_corrections(
    db: Session,
    company_id: int | None,
    company_name: str,
    period: str,
    corrections: List[CorrectionProcessItem],
) -> CorrectionProcessResponse:
    """
    Route each correction by tag. Returns counts by tag and metadata.

    For company_specific corrections: queues the correction in the DB, then
    immediately runs the Layer A → Layer B AI pipeline inline (non-blocking on failure).
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    counts = {"one_off_error": 0, "general_fix": 0, "company_specific": 0}
    company_specific_queued = 0
    queued_ids: List[int] = []

    for item in corrections:
        tag = item.tag or "one_off_error"

        if tag == "one_off_error":
            counts["one_off_error"] += 1

        elif tag == "general_fix":
            _append_general_fix_csv(company_name, period, item, timestamp)
            counts["general_fix"] += 1

        elif tag == "company_specific":
            if company_id is not None:
                new_id = _queue_company_specific(db, company_id, company_name, period, item)
                queued_ids.append(new_id)
                company_specific_queued += 1
            counts["company_specific"] += 1

    # Commit all queued corrections before running the pipeline
    if company_specific_queued > 0:
        try:
            db.commit()
        except Exception:
            db.rollback()
            queued_ids.clear()

    # Run the Layer A → Layer B pipeline for each queued correction (non-fatal)
    if queued_ids:
        from app.services.company_context_service import process_correction
        for correction_id in queued_ids:
            try:
                process_correction(correction_id, db)
            except Exception as exc:
                print(
                    f"[correction_router] AI pipeline failed for correction "
                    f"{correction_id}: {exc}"
                )

    return CorrectionProcessResponse(
        processed=counts,
        general_fix_csv_path=str(GENERAL_FIXES_CSV),
        company_specific_queued=company_specific_queued,
    )
