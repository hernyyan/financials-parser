"""
CorrectionPipeline — the Layer A → Layer B processing pipeline for company_specific corrections.

Single interface: CorrectionPipeline.process(correction_id, db) → PipelineResult

Steps:
1. Load correction from DB (join companies for context)
2. Run Layer A (Sonnet): convert raw correction → clean instruction
3. Check UNCLEAR from Layer A
4. Read current context from DB
5. Run Layer B (Opus): integrate instruction into context markdown
6. Write updated context to DB if action is AMEND or APPEND
7. Check word count, emit alert if over limit
8. Log to changelog
9. Mark correction as processed in DB
"""
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import DATA_DIR, LAYER_A_MODEL, LAYER_B_MODEL
from app.services.claude_service import get_claude_service
from app.utils.text_utils import markdown_body_word_count, COMPANY_CONTEXT_WORD_LIMIT, COMPANY_CONTEXT_WORD_WARNING

logger = logging.getLogger(__name__)

CHANGELOG_PATH = DATA_DIR / "company_context_changelog.jsonl"
ALERTS_PATH = DATA_DIR / "alerts.jsonl"


@dataclass
class PipelineResult:
    correction_id: int
    success: bool
    action: str          # "AMEND", "APPEND", "DISCARD", "SKIPPED", "ERROR"
    detail: str
    layer_a_instruction: Optional[str]
    word_count: int
    alert_emitted: bool
    error: Optional[str]


class CorrectionPipeline:
    """Processes company_specific corrections through the Layer A → Layer B AI pipeline."""

    def process(self, correction_id: int, db: Session) -> PipelineResult:
        """Run the full pipeline for a single correction ID. Always marks the correction as processed."""
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

        # Step 1 — Load correction
        row = db.execute(
            text("""
                SELECT csc.id, csc.company_id, csc.company_name, csc.period,
                       csc.statement_type, csc.field_name,
                       csc.layer2_value, csc.layer2_reasoning, csc.layer2_validation,
                       csc.corrected_value, csc.analyst_reasoning, csc.processed
                FROM company_specific_corrections csc
                WHERE csc.id = :id
            """),
            {"id": correction_id},
        ).fetchone()

        if not row:
            return PipelineResult(
                correction_id=correction_id,
                success=False,
                action="ERROR",
                detail="Correction not found in database.",
                layer_a_instruction=None,
                word_count=0,
                alert_emitted=False,
                error="Correction not found in database.",
            )

        (
            _cid, company_id, company_name, period, statement_type, field_name,
            layer2_value, layer2_reasoning, layer2_validation,
            corrected_value, analyst_reasoning, processed,
        ) = row

        if processed:
            return PipelineResult(
                correction_id=correction_id,
                success=True,
                action="SKIPPED",
                detail="Already processed.",
                layer_a_instruction=None,
                word_count=0,
                alert_emitted=False,
                error=None,
            )

        claude = get_claude_service()

        # Step 2 — Layer A
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
            self._append_changelog({
                "timestamp": timestamp, "company_id": company_id,
                "company_name": company_name, "correction_id": correction_id,
                "field_name": field_name, "statement_type": statement_type,
                "layer_a_instruction": None, "layer_a_referenced_fields": [],
                "layer_b_action": "SKIPPED", "layer_b_detail": f"Layer A failed: {exc}",
                "markdown_section_affected": None,
            })
            self._mark_processed(correction_id, db)
            return PipelineResult(
                correction_id=correction_id, success=False, action="SKIPPED",
                detail=f"Layer A failed: {exc}", layer_a_instruction=None,
                word_count=0, alert_emitted=False, error=str(exc),
            )

        # Step 3 — UNCLEAR check
        if "UNCLEAR" in instruction:
            self._append_changelog({
                "timestamp": timestamp, "company_id": company_id,
                "company_name": company_name, "correction_id": correction_id,
                "field_name": field_name, "statement_type": statement_type,
                "layer_a_instruction": instruction,
                "layer_a_referenced_fields": referenced_fields,
                "layer_b_action": "SKIPPED",
                "layer_b_detail": "Layer A could not generate instruction",
                "markdown_section_affected": None,
            })
            self._mark_processed(correction_id, db)
            return PipelineResult(
                correction_id=correction_id, success=False, action="SKIPPED",
                detail="Layer A returned UNCLEAR — manual review needed.",
                layer_a_instruction=instruction, word_count=0,
                alert_emitted=False, error=None,
            )

        # Step 4 — Read current context from DB
        ctx_row = db.execute(
            text("SELECT context FROM companies WHERE id = :id"),
            {"id": company_id},
        ).fetchone()
        current_markdown = (ctx_row[0] or "") if ctx_row else ""
        if not current_markdown.strip():
            current_markdown = f"# {company_name} — Classification Context\n\n"

        # Step 5 — Layer B
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
            self._append_changelog({
                "timestamp": timestamp, "company_id": company_id,
                "company_name": company_name, "correction_id": correction_id,
                "field_name": field_name, "statement_type": statement_type,
                "layer_a_instruction": instruction,
                "layer_a_referenced_fields": referenced_fields,
                "layer_b_action": "ERROR", "layer_b_detail": f"Layer B failed: {exc}",
                "markdown_section_affected": None,
            })
            self._mark_processed(correction_id, db)
            return PipelineResult(
                correction_id=correction_id, success=False, action="ERROR",
                detail=f"Layer B failed: {exc}", layer_a_instruction=instruction,
                word_count=0, alert_emitted=False, error=str(exc),
            )

        # Step 6 — Write context to DB
        word_count = 0
        if action in ("AMEND", "APPEND") and updated_markdown:
            db.execute(
                text("UPDATE companies SET context = :ctx WHERE id = :id"),
                {"ctx": updated_markdown, "id": company_id},
            )
            word_count = markdown_body_word_count(updated_markdown)

        # Step 7 — Word count alert
        alert_emitted = False
        if word_count > 0:
            alert_emitted = self._check_word_count(
                word_count, company_id, company_name, timestamp
            )

        # Step 8 — Log changelog
        section_affected = self._extract_section(detail)
        self._append_changelog({
            "timestamp": timestamp, "company_id": company_id,
            "company_name": company_name, "correction_id": correction_id,
            "field_name": field_name, "statement_type": statement_type,
            "layer_a_instruction": instruction,
            "layer_a_referenced_fields": referenced_fields,
            "layer_b_action": action, "layer_b_detail": detail,
            "markdown_section_affected": section_affected,
        })

        # Step 9 — Mark processed
        self._mark_processed(correction_id, db)

        return PipelineResult(
            correction_id=correction_id, success=True, action=action,
            detail=detail, layer_a_instruction=instruction,
            word_count=word_count, alert_emitted=alert_emitted, error=None,
        )

    def process_many(self, correction_ids: List[int], db: Session) -> List[PipelineResult]:
        """Process a list of correction IDs sequentially. Each step may update markdown read by the next."""
        results = []
        for cid in correction_ids:
            try:
                result = self.process(cid, db)
            except Exception as exc:
                result = PipelineResult(
                    correction_id=cid, success=False, action="ERROR",
                    detail=str(exc), layer_a_instruction=None,
                    word_count=0, alert_emitted=False, error=str(exc),
                )
            results.append(result)
        return results

    # ── Private helpers ─────────────────────────────────────────────────────────

    def _mark_processed(self, correction_id: int, db: Session) -> None:
        db.execute(
            text("UPDATE company_specific_corrections SET processed = TRUE WHERE id = :id"),
            {"id": correction_id},
        )
        db.commit()

    def _append_changelog(self, entry: dict) -> None:
        with CHANGELOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    def _check_word_count(
        self, wc: int, company_id: int, company_name: str, timestamp: str,
    ) -> bool:
        """Emit an alert if over limit, log warning if approaching. Returns True if alert emitted."""
        if wc > COMPANY_CONTEXT_WORD_LIMIT:
            logger.warning(
                "Company context for %s exceeds %d words (%d). Manual review recommended.",
                company_name, COMPANY_CONTEXT_WORD_LIMIT, wc,
            )
            alert = {
                "timestamp": timestamp, "type": "context_overlength",
                "company_id": company_id, "company_name": company_name,
                "word_count": wc,
                "message": f"Company context exceeds {COMPANY_CONTEXT_WORD_LIMIT:,} word limit. Manual review and condensing recommended.",
                "status": "open",
            }
            with ALERTS_PATH.open("a", encoding="utf-8") as f:
                f.write(json.dumps(alert) + "\n")
            return True
        elif wc > COMPANY_CONTEXT_WORD_WARNING:
            logger.info(
                "Company context for %s approaching limit (%d/%d words).",
                company_name, wc, COMPANY_CONTEXT_WORD_LIMIT,
            )
        return False

    @staticmethod
    def _extract_section(detail: str) -> Optional[str]:
        match = re.search(r"(### [^\n\"]+)", detail)
        return match.group(1).strip() if match else None


# ── Module-level singleton ─────────────────────────────────────────────────────

_pipeline: Optional[CorrectionPipeline] = None


def get_pipeline() -> CorrectionPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = CorrectionPipeline()
    return _pipeline
