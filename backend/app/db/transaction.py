"""
db_transaction — context manager for commit/rollback in route handlers.

Encapsulates the three-clause try/except pattern that every mutating route
needs: commit on success, rollback + re-raise on HTTPException, rollback +
log + wrap in HTTP 500 on any other exception.

Usage:
    with db_transaction(db, "Failed to rename company"):
        rename_company(company_id, old_name, new_name, db)
"""
import logging
from contextlib import contextmanager

from fastapi import HTTPException
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@contextmanager
def db_transaction(db: Session, detail: str = "Operation failed"):
    """
    Commit on success, rollback on failure.

    - HTTPException from the body: rolls back and re-raises unchanged.
    - Any other exception: rolls back, logs a warning, raises HTTP 500
      with ``detail: <exc>`` as the response body.
    """
    try:
        yield
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.warning("%s: %s", detail, exc)
        raise HTTPException(status_code=500, detail=f"{detail}: {exc}")
