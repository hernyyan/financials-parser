"""
Company Context Service — public entry points for the correction pipeline.

reset_company_for_reprocessing(company_id, company_name, db)
                               — wipe context + changelog + processed flags
process_correction(correction_id, db)
                               — run pipeline for a single queued correction
process_pending_corrections(company_id, db)
                               — run pipeline for all unprocessed corrections
write_rule(company_id, company_name, current_markdown,
           field_name, statement_type, rule_text, db)
                               — run Layer A → Layer B for an admin-authored rule

Both correction functions delegate to CorrectionPipeline. These functions exist for
backward compatibility with routes/companies.py (reprocess endpoint) and
correction_router.py.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

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


def write_rule(
    company_id: int,
    company_name: str,
    current_markdown: str,
    field_name: str,
    statement_type: str,
    rule_text: str,
    db: Session,
) -> Dict[str, Any]:
    """
    Run Layer A (instruction rewriting) → Layer B (markdown integration) for an
    admin-authored rule, persist the result, and log to correction_changelog.

    Returns a dict suitable for direct JSON serialisation:
      success, layer_a_instruction, layer_a_referenced_fields,
      layer_b_action, layer_b_detail, updated_markdown
    """
    from app.config import LAYER_A_MODEL, LAYER_B_MODEL
    from app.services.claude_service import get_claude_service

    claude = get_claude_service()
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    # ── Layer A: rewrite free-text rule into a canonical instruction ─────────
    layer_a_raw = claude.call_claude(
        prompt_key="layer_a_instruction_rewriter",
        variables={
            "field_name": field_name,
            "statement_type": statement_type,
            "layer2_value": "N/A (admin-authored rule)",
            "layer2_reasoning": "N/A (admin-authored rule)",
            "corrected_value": "N/A (admin-authored rule)",
            "analyst_reasoning": rule_text,
        },
        model=LAYER_A_MODEL,
        max_tokens=2048,
    )
    layer_a_parsed = claude.parse_json_response(layer_a_raw)
    instruction = layer_a_parsed.get("instruction", "")
    referenced_fields = layer_a_parsed.get("referenced_fields", [field_name])

    # ── Layer B: integrate instruction into the company context markdown ──────
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

    # ── Persist: update context if not discarded ─────────────────────────────
    if updated_markdown and action != "DISCARD":
        db.execute(
            text("UPDATE companies SET context = :ctx WHERE id = :id"),
            {"ctx": updated_markdown, "id": company_id},
        )
        db.commit()

    # ── Persist: always log to changelog ─────────────────────────────────────
    db.execute(
        text("""
            INSERT INTO correction_changelog
                (timestamp, company_id, company_name, field_name, statement_type,
                 layer_a_instruction, layer_b_action, layer_b_detail, source)
            VALUES
                (:ts, :cid, :cn, :fn, :st, :la_instr, :lb_action, :lb_detail, 'admin_portal')
        """),
        {
            "ts": timestamp,
            "cid": company_id,
            "cn": company_name,
            "fn": field_name,
            "st": statement_type,
            "la_instr": instruction,
            "lb_action": action,
            "lb_detail": detail,
        },
    )
    db.commit()

    return {
        "success": True,
        "layer_a_instruction": instruction,
        "layer_a_referenced_fields": referenced_fields,
        "layer_b_action": action,
        "layer_b_detail": detail,
        "updated_markdown": updated_markdown if action != "DISCARD" else current_markdown,
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
