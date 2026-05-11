"""
FinalizeService — persist a finalized review to the reviews table.

Single interface: FinalizeService.persist(session_id, company_name, reporting_period,
                                           final_output, corrections, db) → finalized_at
"""
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import text


class FinalizeService:
    """Owns the upsert logic for writing a finalized review to the DB."""

    def persist(
        self,
        session_id: Optional[str],
        company_name: str,
        reporting_period: str,
        final_output: Dict[str, Any],
        corrections: List[Any],
        db: Session,
    ) -> str:
        """
        Upsert a finalized review row. Returns the ISO finalized_at timestamp.

        Does NOT commit — caller owns the transaction boundary.

        If session_id is provided: UPDATE existing row; if no row exists, INSERT.
        If session_id is None: INSERT a new row without a session_id.
        """
        now = datetime.now(timezone.utc).isoformat()
        corrections_json = json.dumps(corrections)
        final_output_json = json.dumps(final_output)

        if session_id:
            result = db.execute(
                text("""
                    UPDATE reviews
                    SET status           = 'finalized',
                        finalized_at     = :finalized_at,
                        company_name     = :company_name,
                        reporting_period = :reporting_period,
                        final_output     = :final_output,
                        corrections      = :corrections
                    WHERE session_id = :session_id
                """),
                {
                    "session_id": session_id,
                    "company_name": company_name,
                    "reporting_period": reporting_period,
                    "finalized_at": now,
                    "final_output": final_output_json,
                    "corrections": corrections_json,
                },
            )
            if result.rowcount == 0:
                db.execute(
                    text("""
                        INSERT INTO reviews
                            (session_id, company_name, reporting_period, status,
                             finalized_at, final_output, corrections)
                        VALUES
                            (:session_id, :company_name, :reporting_period, 'finalized',
                             :finalized_at, :final_output, :corrections)
                    """),
                    {
                        "session_id": session_id,
                        "company_name": company_name,
                        "reporting_period": reporting_period,
                        "finalized_at": now,
                        "final_output": final_output_json,
                        "corrections": corrections_json,
                    },
                )
        else:
            db.execute(
                text("""
                    INSERT INTO reviews
                        (company_name, reporting_period, status,
                         finalized_at, final_output, corrections)
                    VALUES
                        (:company_name, :reporting_period, 'finalized',
                         :finalized_at, :final_output, :corrections)
                """),
                {
                    "company_name": company_name,
                    "reporting_period": reporting_period,
                    "finalized_at": now,
                    "final_output": final_output_json,
                    "corrections": corrections_json,
                },
            )
        return now


_service: FinalizeService | None = None


def get_finalize_service() -> FinalizeService:
    global _service
    if _service is None:
        _service = FinalizeService()
    return _service
