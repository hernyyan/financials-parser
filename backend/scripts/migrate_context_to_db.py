"""
One-time migration: reads company context markdown files from disk and writes
their content into the companies.context column in Postgres.

Run once after deploying the context-to-DB change:
    cd backend && python scripts/migrate_context_to_db.py

Safe to run multiple times — only updates companies where context IS NULL or empty.
"""
import os
import sys
from pathlib import Path

# Add backend root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(override=True)

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://henry:henry@localhost:5432/henry_db")
# Infer legacy context dir from env (same default as old config)
COMPANY_CONTEXT_DIR = Path(__file__).resolve().parent.parent / os.getenv("COMPANY_CONTEXT_DIR", "company_context")

engine = create_engine(DATABASE_URL)

def migrate():
    with engine.connect() as conn:
        # First ensure context column exists (idempotent)
        try:
            conn.execute(text("ALTER TABLE companies ADD COLUMN context TEXT DEFAULT ''"))
            conn.commit()
            print("Added context column.")
        except Exception:
            print("context column already exists, skipping ALTER.")

        rows = conn.execute(
            text("SELECT id, name, markdown_filename FROM companies WHERE (context IS NULL OR context = '')")
        ).fetchall()

        if not rows:
            print("No companies need migration.")
            return

        migrated = 0
        skipped = 0
        for row in rows:
            company_id, name = row[0], row[1]
            # markdown_filename column may not exist in new schema — use fallback
            try:
                md_filename = row[2]
            except IndexError:
                md_filename = None

            content = None

            # Try the stored filename first
            if md_filename:
                path = COMPANY_CONTEXT_DIR / md_filename
                if path.exists():
                    content = path.read_text(encoding="utf-8")

            # Fall back to derived filename
            if not content:
                import re
                safe = re.sub(r"[^a-z0-9_]", "", name.lower().replace(" ", "_"))
                path = COMPANY_CONTEXT_DIR / f"{safe}.md"
                if path.exists():
                    content = path.read_text(encoding="utf-8")

            if content:
                conn.execute(
                    text("UPDATE companies SET context = :ctx WHERE id = :id"),
                    {"ctx": content, "id": company_id},
                )
                migrated += 1
                print(f"  Migrated: {name} ({len(content)} chars)")
            else:
                # Write a blank header so context is never null
                blank = f"# {name} — Classification Context\n\n"
                conn.execute(
                    text("UPDATE companies SET context = :ctx WHERE id = :id"),
                    {"ctx": blank, "id": company_id},
                )
                skipped += 1
                print(f"  No file found for: {name} — wrote blank header")

        conn.commit()
        print(f"\nDone. Migrated: {migrated}, Blank header written: {skipped}")

if __name__ == "__main__":
    migrate()
