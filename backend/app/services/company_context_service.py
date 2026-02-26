"""
Company Context Service — Layer A → Layer B AI pipeline.

Processes queued company_specific corrections:
1. Reads correction from DB
2. Layer A (Sonnet): converts raw correction to clean instruction
3. Layer B (Opus): integrates instruction into company markdown file
4. Logs every action to company_context_changelog.jsonl
5. Marks correction as processed in DB
"""
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import COMPANY_CONTEXT_DIR, DATA_DIR, LAYER_A_MODEL, LAYER_B_MODEL
from app.services.claude_service import get_claude_service

CHANGELOG_PATH = DATA_DIR / "company_context_changelog.jsonl"


def _get_markdown_path(markdown_filename: str) -> Path:
    return COMPANY_CONTEXT_DIR / markdown_filename


def _append_changelog(entry: dict) -> None:
    """Append one JSON line to the changelog file."""
    with CHANGELOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def _extract_section_from_detail(detail: str) -> Optional[str]:
    """Try to extract a '### Section Name' header from Layer B's detail string."""
    match = re.search(r"(### [^\n\"]+)", detail)
    if match:
        return match.group(1).strip()
    return None


def process_correction(correction_id: int, db: Session) -> dict:
    """
    Run the Layer A → Layer B pipeline for a single queued correction.

    Returns a summary dict with keys: correction_id, action, detail, layer_a_instruction.
    Marks the correction as processed regardless of success/failure.
    """
    # 1. Load the correction (join companies for markdown_filename)
    row = db.execute(
        text("""
            SELECT csc.id, csc.company_id, csc.company_name, csc.period,
                   csc.statement_type, csc.field_name,
                   csc.layer2_value, csc.layer2_reasoning, csc.layer2_validation,
                   csc.corrected_value, csc.analyst_reasoning, csc.processed,
                   c.markdown_filename
            FROM company_specific_corrections csc
            LEFT JOIN companies c ON csc.company_id = c.id
            WHERE csc.id = :id
        """),
        {"id": correction_id},
    ).fetchone()

    if not row:
        return {
            "correction_id": correction_id,
            "action": "ERROR",
            "detail": "Correction not found in database.",
            "layer_a_instruction": None,
        }

    (
        _cid, company_id, company_name, period, statement_type, field_name,
        layer2_value, layer2_reasoning, layer2_validation,
        corrected_value, analyst_reasoning, processed, markdown_filename,
    ) = row

    if processed:
        return {
            "correction_id": correction_id,
            "action": "SKIPPED",
            "detail": "Already processed.",
            "layer_a_instruction": None,
        }

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    claude = get_claude_service()

    # ── Layer A ────────────────────────────────────────────────────────────────
    try:
        layer_a_raw = claude.call_claude(
            prompt_key="layer_a_instruction_rewriter",
            variables={
                "field_name": str(field_name),
                "statement_type": str(statement_type),
                "layer2_value": str(layer2_value) if layer2_value is not None else "null",
                "layer2_reasoning": str(layer2_reasoning or ""),
                "corrected_value": str(corrected_value),
                "analyst_reasoning": str(analyst_reasoning or ""),
            },
            model=LAYER_A_MODEL,
            max_tokens=2048,
        )
        layer_a_data = claude.parse_json_response(layer_a_raw)
        instruction: str = layer_a_data.get("instruction", "")
        referenced_fields: list = layer_a_data.get("referenced_fields", [field_name])
    except Exception as exc:
        _append_changelog({
            "timestamp": timestamp,
            "company_id": company_id,
            "company_name": company_name,
            "correction_id": correction_id,
            "field_name": field_name,
            "statement_type": statement_type,
            "layer_a_instruction": None,
            "layer_a_referenced_fields": [],
            "layer_b_action": "SKIPPED",
            "layer_b_detail": f"Layer A failed: {exc}",
            "markdown_section_affected": None,
        })
        db.execute(
            text("UPDATE company_specific_corrections SET processed = TRUE WHERE id = :id"),
            {"id": correction_id},
        )
        db.commit()
        return {
            "correction_id": correction_id,
            "action": "SKIPPED",
            "detail": f"Layer A failed: {exc}",
            "layer_a_instruction": None,
        }

    # 3. Handle UNCLEAR from Layer A
    if "UNCLEAR" in instruction:
        _append_changelog({
            "timestamp": timestamp,
            "company_id": company_id,
            "company_name": company_name,
            "correction_id": correction_id,
            "field_name": field_name,
            "statement_type": statement_type,
            "layer_a_instruction": instruction,
            "layer_a_referenced_fields": referenced_fields,
            "layer_b_action": "SKIPPED",
            "layer_b_detail": "Layer A could not generate instruction",
            "markdown_section_affected": None,
        })
        db.execute(
            text("UPDATE company_specific_corrections SET processed = TRUE WHERE id = :id"),
            {"id": correction_id},
        )
        db.commit()
        return {
            "correction_id": correction_id,
            "action": "SKIPPED",
            "detail": "Layer A returned UNCLEAR — manual review needed.",
            "layer_a_instruction": instruction,
        }

    # 4. Read current markdown file
    if markdown_filename:
        markdown_path = _get_markdown_path(markdown_filename)
    else:
        # Fallback: derive filename from company name
        safe = re.sub(r"[^a-z0-9_]", "", company_name.lower().replace(" ", "_"))
        markdown_path = _get_markdown_path(f"{safe}.md")

    if markdown_path.exists():
        current_markdown = markdown_path.read_text(encoding="utf-8")
    else:
        current_markdown = f"# {company_name} — Classification Context\n\n"
        markdown_path.write_text(current_markdown, encoding="utf-8")

    # ── Layer B ────────────────────────────────────────────────────────────────
    try:
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
        layer_b_data = claude.parse_json_response(layer_b_raw)
        action: str = layer_b_data.get("action", "DISCARD")
        detail: str = layer_b_data.get("detail", "")
        updated_markdown: Optional[str] = layer_b_data.get("updated_markdown")
    except Exception as exc:
        _append_changelog({
            "timestamp": timestamp,
            "company_id": company_id,
            "company_name": company_name,
            "correction_id": correction_id,
            "field_name": field_name,
            "statement_type": statement_type,
            "layer_a_instruction": instruction,
            "layer_a_referenced_fields": referenced_fields,
            "layer_b_action": "ERROR",
            "layer_b_detail": f"Layer B failed: {exc}",
            "markdown_section_affected": None,
        })
        db.execute(
            text("UPDATE company_specific_corrections SET processed = TRUE WHERE id = :id"),
            {"id": correction_id},
        )
        db.commit()
        return {
            "correction_id": correction_id,
            "action": "ERROR",
            "detail": f"Layer B failed: {exc}",
            "layer_a_instruction": instruction,
        }

    # 6. Apply result — overwrite markdown for AMEND or APPEND
    if action in ("AMEND", "APPEND") and updated_markdown:
        markdown_path.write_text(updated_markdown, encoding="utf-8")

    # 7. Log to changelog
    section_affected = _extract_section_from_detail(detail)
    _append_changelog({
        "timestamp": timestamp,
        "company_id": company_id,
        "company_name": company_name,
        "correction_id": correction_id,
        "field_name": field_name,
        "statement_type": statement_type,
        "layer_a_instruction": instruction,
        "layer_a_referenced_fields": referenced_fields,
        "layer_b_action": action,
        "layer_b_detail": detail,
        "markdown_section_affected": section_affected,
    })

    # 8. Mark as processed
    db.execute(
        text("UPDATE company_specific_corrections SET processed = TRUE WHERE id = :id"),
        {"id": correction_id},
    )
    db.commit()

    return {
        "correction_id": correction_id,
        "action": action,
        "detail": detail,
        "layer_a_instruction": instruction,
    }


def process_pending_corrections(company_id: int, db: Session) -> list[dict]:
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

    results = []
    for row in rows:
        try:
            result = process_correction(row[0], db)
        except Exception as exc:
            result = {
                "correction_id": row[0],
                "action": "ERROR",
                "detail": str(exc),
                "layer_a_instruction": None,
            }
        results.append(result)

    return results
