"""
Shared company creation and name-normalization logic.

Both the wizard endpoint (POST /companies) and the admin endpoint
(POST /admin/companies) create companies with identical validation rules.
This service is the single source of truth for that logic so the two routes
cannot diverge (e.g. one doing case-sensitive and the other case-insensitive
exact-duplicate detection).
"""
from __future__ import annotations

import re
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text


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
