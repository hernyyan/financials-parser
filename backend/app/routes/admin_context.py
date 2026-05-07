"""
Admin endpoints for company context management.

GET  /admin/company-context/{company_id} — Full context contents from DB
PUT  /admin/company-context/{company_id} — Overwrite the context in DB
POST /admin/write-rule                   — Submit a rule through Layer A → Layer B pipeline
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import DATA_DIR, LAYER_A_MODEL, LAYER_B_MODEL
from app.db.database import get_db
from app.models.schemas import AdminContextUpdateRequest, AdminWriteRuleRequest
from app.services.claude_service import get_claude_service
from app.utils.text_utils import markdown_body_word_count

router = APIRouter(prefix="/admin")


@router.get("/company-context/{company_id}")
def admin_company_context(company_id: int, db: Session = Depends(get_db)):
    """Return the full contents of a company's context from DB."""
    row = db.execute(
        text("SELECT id, name, context FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Company {company_id} not found.")

    name = row[1]
    content = row[2] or ""
    word_count = markdown_body_word_count(content) if content.strip() else 0

    return {
        "id": company_id,
        "name": name,
        "word_count": word_count,
        "content": content,
    }


@router.put("/company-context/{company_id}")
def admin_update_company_context(
    company_id: int,
    request: AdminContextUpdateRequest,
    db: Session = Depends(get_db),
):
    """Directly overwrite the company's context in DB."""
    row = db.execute(
        text("SELECT id FROM companies WHERE id = :id"),
        {"id": company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")

    db.execute(
        text("UPDATE companies SET context = :ctx WHERE id = :id"),
        {"ctx": request.content, "id": company_id},
    )
    db.commit()

    return {"success": True, "word_count": markdown_body_word_count(request.content)}


@router.post("/write-rule")
def admin_write_rule(
    request: AdminWriteRuleRequest,
    db: Session = Depends(get_db),
):
    """Submit a rule through Layer A → Layer B pipeline."""
    row = db.execute(
        text("SELECT id, name, context FROM companies WHERE id = :company_id"),
        {"company_id": request.company_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")

    company_id, company_name, current_context = row
    current_markdown = current_context or f"# {company_name} — Classification Context\n\n"

    claude = get_claude_service()
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    layer_a_raw = claude.call_claude(
        prompt_key="layer_a_instruction_rewriter",
        variables={
            "field_name": request.field_name,
            "statement_type": request.statement_type,
            "layer2_value": "N/A (admin-authored rule)",
            "layer2_reasoning": "N/A (admin-authored rule)",
            "corrected_value": "N/A (admin-authored rule)",
            "analyst_reasoning": request.rule_text,
        },
        model=LAYER_A_MODEL,
        max_tokens=2048,
    )
    layer_a_parsed = claude.parse_json_response(layer_a_raw)
    instruction = layer_a_parsed.get("instruction", "")
    referenced_fields = layer_a_parsed.get("referenced_fields", [request.field_name])

    layer_b_raw = claude.call_claude(
        prompt_key="layer_b_markdown_integrator",
        variables={
            "new_instruction": instruction,
            "referenced_fields": json.dumps(referenced_fields),
            "current_markdown": current_markdown,
        },
        model=LAYER_B_MODEL,
        max_tokens=8192,
    )
    layer_b_parsed = claude.parse_json_response(layer_b_raw)
    action = layer_b_parsed.get("action", "UNKNOWN")
    detail = layer_b_parsed.get("detail", "")
    updated_markdown = layer_b_parsed.get("updated_markdown")

    if updated_markdown and action != "DISCARD":
        db.execute(
            text("UPDATE companies SET context = :ctx WHERE id = :id"),
            {"ctx": updated_markdown, "id": company_id},
        )
        db.commit()

    changelog_entry = {
        "timestamp": timestamp,
        "company_id": company_id,
        "company_name": company_name,
        "source": "admin_portal",
        "field_name": request.field_name,
        "statement_type": request.statement_type,
        "layer_a_instruction": instruction,
        "layer_b_action": action,
        "layer_b_detail": detail,
    }
    changelog_path = DATA_DIR / "company_context_changelog.jsonl"
    with changelog_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(changelog_entry) + "\n")

    return {
        "success": True,
        "layer_a_instruction": instruction,
        "layer_a_referenced_fields": referenced_fields,
        "layer_b_action": action,
        "layer_b_detail": detail,
        "updated_markdown": updated_markdown if action != "DISCARD" else current_markdown,
    }
