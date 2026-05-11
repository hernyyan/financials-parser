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
9. Mark correction as processed in DB (commits steps 6+9 atomically)
"""
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.company_service import get_company_or_404

from app.config import LAYER_A_MODEL, LAYER_B_MODEL
from app.services.claude_service import get_claude_service
from app.utils.text_utils import markdown_body_word_count, COMPANY_CONTEXT_WORD_LIMIT, COMPANY_CONTEXT_WORD_WARNING

logger = logging.getLogger(__name__)



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


@dataclass
class _CorrectionRow:
    correction_id: int
    company_id: int
    company_name: str
    period: str
    statement_type: str
    field_name: str
    layer2_value: Optional[float]
    layer2_reasoning: Optional[str]
    layer2_validation: Optional[str]
    corrected_value: float
    analyst_reasoning: Optional[str]


@dataclass
class _LayerAResult:
    instruction: str
    referenced_fields: List[str]


@dataclass
class _LayerBResult:
    action: str
    detail: str
    updated_markdown: Optional[str]


class CorrectionPipeline:
    """Processes company_specific corrections through the Layer A → Layer B AI pipeline."""

    def process(self, correction_id: int, db: Session) -> PipelineResult:
        """Run the full pipeline for a single correction ID. Always marks the correction as processed."""
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

        # Step 1 — Load correction
        row = self._load_correction(correction_id, db)
        if row is None:
            return PipelineResult(
                correction_id=correction_id, success=False, action="ERROR",
                detail="Correction not found in database.", layer_a_instruction=None,
                word_count=0, alert_emitted=False, error="Correction not found in database.",
            )

        if self._is_already_processed(correction_id, db):
            return PipelineResult(
                correction_id=correction_id, success=True, action="SKIPPED",
                detail="Already processed.", layer_a_instruction=None,
                word_count=0, alert_emitted=False, error=None,
            )

        claude = get_claude_service()

        # Step 2 — Layer A
        try:
            layer_a = self._run_layer_a(row, claude)
        except Exception as exc:
            self._write_changelog(db, _changelog_entry(
                timestamp, row, layer_a_instruction=None, referenced_fields=[],
                action="SKIPPED", detail=f"Layer A failed: {exc}", section=None,
            ))
            self._mark_processed(correction_id, db)
            return PipelineResult(
                correction_id=correction_id, success=False, action="SKIPPED",
                detail=f"Layer A failed: {exc}", layer_a_instruction=None,
                word_count=0, alert_emitted=False, error=str(exc),
            )

        # Step 3 — UNCLEAR check
        if "UNCLEAR" in layer_a.instruction:
            self._write_changelog(db, _changelog_entry(
                timestamp, row, layer_a_instruction=layer_a.instruction,
                referenced_fields=layer_a.referenced_fields,
                action="SKIPPED", detail="Layer A could not generate instruction", section=None,
            ))
            self._mark_processed(correction_id, db)
            return PipelineResult(
                correction_id=correction_id, success=False, action="SKIPPED",
                detail="Layer A returned UNCLEAR — manual review needed.",
                layer_a_instruction=layer_a.instruction, word_count=0,
                alert_emitted=False, error=None,
            )

        # Step 4 — Read current context from DB
        current_markdown = self._load_context(row.company_id, db)

        # Step 5 — Layer B
        try:
            layer_b = self._run_layer_b(layer_a, current_markdown, claude)
        except Exception as exc:
            self._write_changelog(db, _changelog_entry(
                timestamp, row, layer_a_instruction=layer_a.instruction,
                referenced_fields=layer_a.referenced_fields,
                action="ERROR", detail=f"Layer B failed: {exc}", section=None,
            ))
            self._mark_processed(correction_id, db)
            return PipelineResult(
                correction_id=correction_id, success=False, action="ERROR",
                detail=f"Layer B failed: {exc}", layer_a_instruction=layer_a.instruction,
                word_count=0, alert_emitted=False, error=str(exc),
            )

        # Step 6 — Write context to DB (not yet committed — commits atomically with step 9)
        word_count = self._write_context(row.company_id, layer_b, db)

        # Step 7 — Word count alert (written to DB, commits atomically with step 9)
        alert_emitted = False
        if word_count > 0:
            alert_emitted = self._check_word_count(word_count, row.company_id, row.company_name, timestamp, db)

        # Step 8 — Log changelog (written to DB, commits atomically with step 9)
        section = _extract_section(layer_b.detail)
        self._write_changelog(db, _changelog_entry(
            timestamp, row, layer_a_instruction=layer_a.instruction,
            referenced_fields=layer_a.referenced_fields,
            action=layer_b.action, detail=layer_b.detail, section=section,
        ))

        # Step 9 — Mark processed + commit (atomically commits steps 6, 7, 8)
        self._mark_processed(correction_id, db)

        return PipelineResult(
            correction_id=correction_id, success=True, action=layer_b.action,
            detail=layer_b.detail, layer_a_instruction=layer_a.instruction,
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

    # ── Named steps ─────────────────────────────────────────────────────────────

    def _load_correction(self, correction_id: int, db: Session) -> Optional[_CorrectionRow]:
        """Step 1: Load correction record from DB. Returns None if not found."""
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
            return None

        (
            _cid, company_id, company_name, period, statement_type, field_name,
            layer2_value, layer2_reasoning, layer2_validation,
            corrected_value, analyst_reasoning, _processed,
        ) = row

        return _CorrectionRow(
            correction_id=correction_id,
            company_id=company_id,
            company_name=company_name,
            period=period,
            statement_type=statement_type,
            field_name=field_name,
            layer2_value=layer2_value,
            layer2_reasoning=layer2_reasoning,
            layer2_validation=layer2_validation,
            corrected_value=corrected_value,
            analyst_reasoning=analyst_reasoning,
        )

    def _is_already_processed(self, correction_id: int, db: Session) -> bool:
        """Step 1b: Guard against double-processing."""
        row = db.execute(
            text("SELECT processed FROM company_specific_corrections WHERE id = :id"),
            {"id": correction_id},
        ).fetchone()
        return bool(row and row[0])

    def _run_layer_a(self, row: _CorrectionRow, claude: Any) -> _LayerAResult:
        """Step 2: Run Layer A prompt to produce a clean instruction from the raw correction.

        Raises on any Claude or parse error — caller decides how to handle.
        """
        layer_a_raw = claude.call_claude(
            prompt_key="layer_a_instruction_rewriter",
            variables={
                "field_name": str(row.field_name),
                "statement_type": str(row.statement_type),
                "layer2_value": str(row.layer2_value) if row.layer2_value is not None else "null",
                "layer2_reasoning": str(row.layer2_reasoning or ""),
                "corrected_value": str(row.corrected_value),
                "analyst_reasoning": str(row.analyst_reasoning or ""),
            },
            model=LAYER_A_MODEL,
            max_tokens=2048,
        )
        layer_a_data = claude.parse_json_response(layer_a_raw)
        return _LayerAResult(
            instruction=layer_a_data.get("instruction", ""),
            referenced_fields=layer_a_data.get("referenced_fields", [row.field_name]),
        )

    def _load_context(self, company_id: int, db: Session) -> str:
        """Step 4: Read the company's current context markdown from DB."""
        _, company_name, context = get_company_or_404(company_id, db)
        return context or f"# {company_name} — Classification Context\n\n"

    def _run_layer_b(
        self, layer_a: _LayerAResult, current_markdown: str, claude: Any
    ) -> _LayerBResult:
        """Step 5: Run Layer B prompt to integrate the instruction into context markdown.

        Raises on any Claude or parse error — caller decides how to handle.
        """
        layer_b_raw = claude.call_claude(
            prompt_key="layer_b_markdown_integrator",
            variables={
                "new_instruction": layer_a.instruction,
                "referenced_fields": json.dumps(layer_a.referenced_fields),
                "current_markdown": current_markdown,
            },
            model=LAYER_B_MODEL,
            max_tokens=8192,
        )
        layer_b_data = claude.parse_json_response(layer_b_raw)
        return _LayerBResult(
            action=layer_b_data.get("action", "DISCARD"),
            detail=layer_b_data.get("detail", ""),
            updated_markdown=layer_b_data.get("updated_markdown"),
        )

    def _write_context(self, company_id: int, layer_b: _LayerBResult, db: Session) -> int:
        """Step 6: Write updated markdown to DB if action is AMEND or APPEND.

        Does NOT commit — the caller commits atomically with _mark_processed (step 9).
        Returns the new word count (0 if no write performed).
        """
        if layer_b.action in ("AMEND", "APPEND") and layer_b.updated_markdown:
            db.execute(
                text("UPDATE companies SET context = :ctx WHERE id = :id"),
                {"ctx": layer_b.updated_markdown, "id": company_id},
            )
            return markdown_body_word_count(layer_b.updated_markdown)
        return 0

    def _mark_processed(self, correction_id: int, db: Session) -> None:
        """Step 9: Mark the correction as processed and commit the transaction.

        Commits atomically with any preceding db.execute() calls in this session
        (e.g. the context write from step 6).
        """
        db.execute(
            text("UPDATE company_specific_corrections SET processed = TRUE WHERE id = :id"),
            {"id": correction_id},
        )
        db.commit()

    def _write_changelog(self, db: Session, entry: dict) -> None:
        """Step 8: Insert a changelog entry into the DB. Does NOT commit — caller commits."""
        db.execute(
            text("""
                INSERT INTO correction_changelog
                    (timestamp, company_id, company_name, correction_id,
                     field_name, statement_type, layer_a_instruction,
                     layer_a_referenced_fields, layer_b_action, layer_b_detail,
                     markdown_section_affected, source)
                VALUES
                    (:ts, :cid, :cn, :corr_id, :fn, :st, :la_instr,
                     :la_refs, :lb_action, :lb_detail, :section, :source)
            """),
            {
                "ts": entry.get("timestamp", ""),
                "cid": entry.get("company_id"),
                "cn": entry.get("company_name"),
                "corr_id": entry.get("correction_id"),
                "fn": entry.get("field_name"),
                "st": entry.get("statement_type"),
                "la_instr": entry.get("layer_a_instruction"),
                "la_refs": json.dumps(entry.get("layer_a_referenced_fields") or []),
                "lb_action": entry.get("layer_b_action"),
                "lb_detail": entry.get("layer_b_detail"),
                "section": entry.get("markdown_section_affected"),
                "source": entry.get("source", "pipeline"),
            },
        )

    def _check_word_count(
        self, wc: int, company_id: int, company_name: str, timestamp: str, db: Session,
    ) -> bool:
        """Step 7: Insert alert to DB if over limit, log warning if approaching. Returns True if alert inserted."""
        if wc > COMPANY_CONTEXT_WORD_LIMIT:
            logger.warning(
                "Company context for %s exceeds %d words (%d). Manual review recommended.",
                company_name, COMPANY_CONTEXT_WORD_LIMIT, wc,
            )
            db.execute(
                text("""
                    INSERT INTO context_alerts
                        (timestamp, type, company_id, company_name, word_count, message, status)
                    VALUES
                        (:ts, 'context_overlength', :cid, :cn, :wc, :msg, 'open')
                """),
                {
                    "ts": timestamp,
                    "cid": company_id,
                    "cn": company_name,
                    "wc": wc,
                    "msg": f"Company context exceeds {COMPANY_CONTEXT_WORD_LIMIT:,} word limit. Manual review and condensing recommended.",
                },
            )
            return True
        elif wc > COMPANY_CONTEXT_WORD_WARNING:
            logger.info(
                "Company context for %s approaching limit (%d/%d words).",
                company_name, wc, COMPANY_CONTEXT_WORD_LIMIT,
            )
        return False


# ── Module-level helpers ───────────────────────────────────────────────────────

def _extract_section(detail: str) -> Optional[str]:
    match = re.search(r"(### [^\n\"]+)", detail)
    return match.group(1).strip() if match else None


def _changelog_entry(
    timestamp: str,
    row: _CorrectionRow,
    layer_a_instruction: Optional[str],
    referenced_fields: List[str],
    action: str,
    detail: str,
    section: Optional[str],
) -> Dict[str, Any]:
    return {
        "timestamp": timestamp,
        "company_id": row.company_id,
        "company_name": row.company_name,
        "correction_id": row.correction_id,
        "field_name": row.field_name,
        "statement_type": row.statement_type,
        "layer_a_instruction": layer_a_instruction,
        "layer_a_referenced_fields": referenced_fields,
        "layer_b_action": action,
        "layer_b_detail": detail,
        "markdown_section_affected": section,
    }


# ── Module-level singleton ─────────────────────────────────────────────────────

_pipeline: Optional[CorrectionPipeline] = None


def get_pipeline() -> CorrectionPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = CorrectionPipeline()
    return _pipeline
