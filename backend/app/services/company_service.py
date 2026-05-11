"""
Shared company lifecycle logic: creation, lookup, rename, delete, and reads.

Both the wizard endpoint (POST /companies) and the admin endpoint
(POST /admin/companies) create companies with identical validation rules.
This service is the single source of truth for that logic so the two routes
cannot diverge (e.g. one doing case-sensitive and the other case-insensitive
exact-duplicate detection).

Read functions (list_companies_with_metadata, get_company_finalized_data,
get_company_corrections) are co-located here with the write operations so
all company-entity queries live in one place.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import COMPANY_DATASETS_DIR
from app.utils.json_utils import deserialize_dict
from app.utils.text_utils import markdown_body_word_count


def get_company_or_404(company_id: int, db: Session) -> tuple[int, str, str]:
    """
    Fetch (id, name, context) for a company by primary key.
    Raises HTTPException 404 if no row exists.
    """
    row = db.execute(
        text("SELECT id, name, context FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Company {company_id} not found.")
    return row[0], row[1], row[2] or ""


def rename_company(
    company_id: int,
    old_name: str,
    old_context: str,
    new_name: str,
    db: Session,
) -> None:
    """
    Rename a company everywhere: companies table, reviews, corrections, and
    the datasets directory on disk. Raises HTTPException 409 if new_name is
    already taken by another company. Commits the DB transaction.
    """
    existing = db.execute(
        text("SELECT id FROM companies WHERE LOWER(name) = LOWER(:name) AND id != :id"),
        {"name": new_name, "id": company_id},
    ).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail=f"A company named '{new_name}' already exists.")

    new_context = old_context.replace(
        f"# {old_name} — Classification Context",
        f"# {new_name} — Classification Context",
        1,
    )

    old_dir: Path = COMPANY_DATASETS_DIR / old_name
    new_dir: Path = COMPANY_DATASETS_DIR / new_name
    if old_dir.exists() and old_dir != new_dir:
        old_dir.rename(new_dir)

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


def delete_company(company_id: int, company_name: str, db: Session) -> None:
    """
    Delete a company and all its associated data atomically.

    Filesystem deletion is attempted first (before the DB commit) so that if
    rmtree fails the DB transaction can be rolled back — avoiding a state where
    the company row is gone but the data directory survives.

    Raises HTTPException 500 if the filesystem delete fails.
    Commits the DB transaction on success.
    """
    import shutil

    datasets_dir: Path = COMPANY_DATASETS_DIR / company_name
    if datasets_dir.exists():
        try:
            shutil.rmtree(datasets_dir)
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Could not delete company data directory: {exc}",
            )

    db.execute(
        text("DELETE FROM company_specific_corrections WHERE company_id = :id"),
        {"id": company_id},
    )
    db.execute(
        text("DELETE FROM companies WHERE id = :id"),
        {"id": company_id},
    )
    db.commit()


def normalize_company_name(name: str) -> str:
    """Strip to lowercase alphanumeric for fuzzy duplicate detection."""
    return re.sub(r'[^a-z0-9]', '', name.lower())


def create_company(name: str, db: Session) -> tuple[int, str]:
    """
    Validate and insert a new company row.

    Returns (new_id, stripped_name) on success.
    Raises HTTPException 400 / 409 on validation failures.

    Exact-duplicate check is case-insensitive — matching the stricter
    admin behaviour (previously the public endpoint was case-sensitive,
    allowing "Apple" and "apple" to coexist).
    """
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Company name cannot be empty.")

    # Case-insensitive exact duplicate
    existing_exact = db.execute(
        text("SELECT id FROM companies WHERE LOWER(name) = LOWER(:name)"),
        {"name": name},
    ).fetchone()
    if existing_exact:
        raise HTTPException(status_code=409, detail=f"Company '{name}' already exists.")

    # Normalized (fuzzy) duplicate
    name_normalized = normalize_company_name(name)
    all_rows = db.execute(text("SELECT id, name FROM companies")).fetchall()
    for _, existing_name in all_rows:
        if normalize_company_name(existing_name) == name_normalized:
            raise HTTPException(
                status_code=409,
                detail=f"A similar company already exists: '{existing_name}'. "
                       f"If this is a different company, contact an admin.",
            )

    result = db.execute(
        text("INSERT INTO companies (name, context) VALUES (:name, :ctx) RETURNING id"),
        {"name": name, "ctx": f"# {name} — Classification Context\n\n"},
    )
    new_id = result.fetchone()[0]
    db.commit()

    return new_id, name


# ── Read paths ────────────────────────────────────────────────────────────────

def list_companies_with_metadata(db: Session) -> list[dict[str, Any]]:
    """
    Return all companies with context word count and correction counts
    (total, processed, pending). Ordered by name ASC.
    """
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


def get_company_finalized_data(
    company_id: int, company_name: str, db: Session
) -> dict[str, Any]:
    """
    Return finalized L1/L2 data for a company — latest load per period,
    ordered chronologically. Only periods with a final_output are included.
    """
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

    periods = [
        {
            "session_id": row[0],
            "reporting_period": row[1],
            "layer1_data": deserialize_dict(row[2]),
            "layer2_data": deserialize_dict(row[3]),
            "finalized_at": str(row[4]) if row[4] else None,
            "status": row[5],
            "created_at": str(row[6]) if row[6] else None,
        }
        for row in rows
    ]
    return {"company_id": company_id, "company_name": company_name, "periods": periods}


def get_company_corrections(company_id: int, db: Session) -> dict[str, Any]:
    """Return all company_specific_corrections for a company, newest first."""
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
