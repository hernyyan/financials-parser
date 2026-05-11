"""
StatementTabConfigService — owns all reads and writes to statement_tab_configs.

Functions:
  get_tab_configs(company_id, db) -> dict[str, str]
      Return all saved tab assignments for a company as {statement_type: tab}.

  save_tab_config(company_id, statement_type, tab, db) -> None
      Upsert the tab assignment for one statement type. Commits.
"""
from sqlalchemy.orm import Session
from sqlalchemy import text


def get_tab_configs(company_id: int, db: Session) -> dict[str, str]:
    """Return {statement_type: tab} for all saved configs for this company."""
    rows = db.execute(
        text("SELECT statement_type, tab FROM statement_tab_configs WHERE company_id = :cid"),
        {"cid": company_id},
    ).fetchall()
    return {row[0]: row[1] for row in rows}


def save_tab_config(company_id: int, statement_type: str, tab: str, db: Session) -> None:
    """Upsert the tab assignment for a single statement type. Commits."""
    updated = db.execute(
        text("""
            UPDATE statement_tab_configs
            SET tab = :tab, updated_at = CURRENT_TIMESTAMP
            WHERE company_id = :cid AND statement_type = :stmt
        """),
        {"tab": tab, "cid": company_id, "stmt": statement_type},
    ).rowcount

    if updated == 0:
        db.execute(
            text("""
                INSERT INTO statement_tab_configs (company_id, statement_type, tab)
                VALUES (:cid, :stmt, :tab)
            """),
            {"cid": company_id, "stmt": statement_type, "tab": tab},
        )

    db.commit()
