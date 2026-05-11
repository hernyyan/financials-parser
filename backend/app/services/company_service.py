"""
Shared company lifecycle logic: creation, lookup, and rename.

Both the wizard endpoint (POST /companies) and the admin endpoint
(POST /admin/companies) create companies with identical validation rules.
This service is the single source of truth for that logic so the two routes
cannot diverge (e.g. one doing case-sensitive and the other case-insensitive
exact-duplicate detection).
"""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import COMPANY_DATASETS_DIR


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
