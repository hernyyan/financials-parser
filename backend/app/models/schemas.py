"""
Pydantic request/response models for all API endpoints.
Every data structure passed between frontend and backend has a corresponding model here.
"""
from __future__ import annotations
from typing import Optional, Dict, List
from pydantic import BaseModel


# ─── Shared ───────────────────────────────────────────────────────────────────

class ValidationCheck(BaseModel):
    checkName: str
    status: str  # 'PASS' | 'FAIL'
    details: str


# ─── Layer 1 ──────────────────────────────────────────────────────────────────

class Layer1Result(BaseModel):
    lineItems: Dict[str, float]
    sourceScaling: str
    columnIdentified: str


class Layer1Request(BaseModel):
    sessionId: str
    sheetName: str
    sheetType: str        # 'income_statement' | 'balance_sheet'
    reportingPeriod: str


class Layer1Response(BaseModel):
    sheetName: str
    lineItems: Dict[str, float]
    sourceScaling: str
    columnIdentified: str


# ─── Layer 2 ──────────────────────────────────────────────────────────────────

class Layer2Request(BaseModel):
    session_id: Optional[str] = None
    statement_type: str       # 'income_statement' | 'balance_sheet'
    layer1_data: Dict[str, float]  # Just the lineItems dict from Layer 1


class Layer2Response(BaseModel):
    statementType: str
    values: Dict[str, Optional[float]]
    reasoning: Dict[str, str]
    validation: Dict[str, ValidationCheck]
    flaggedFields: List[str]
    fieldValidations: Dict[str, List[str]]


# ─── Upload ───────────────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    sessionId: str
    sheetNames: List[str]
    workbookUrl: str          # "/files/{session_id}/workbook"


# ─── Corrections ──────────────────────────────────────────────────────────────

class CorrectionRequest(BaseModel):
    sessionId: Optional[str] = None
    fieldName: str
    statementType: str = ""
    originalValue: float
    correctedValue: float
    reasoning: Optional[str] = None
    tag: Optional[str] = None  # 'one_off_error' | 'company_specific' | 'general_fix'


class CorrectionResponse(BaseModel):
    success: bool
    correctionId: Optional[int] = None
    timestamp: str
    message: str


# ─── Template ─────────────────────────────────────────────────────────────────

class TemplateSection(BaseModel):
    header: Optional[str] = None
    fields: List[str]


class TemplateStatement(BaseModel):
    sections: List[TemplateSection]
    allFields: List[str]


class TemplateResponse(BaseModel):
    income_statement: TemplateStatement
    balance_sheet: TemplateStatement


# ─── Finalize ─────────────────────────────────────────────────────────────────

class CorrectionItem(BaseModel):
    fieldName: str
    originalValue: float
    correctedValue: float
    reasoning: Optional[str] = None
    tag: Optional[str] = None
    timestamp: str


class FinalizeRequest(BaseModel):
    sessionId: Optional[str] = None
    companyName: str
    reportingPeriod: str
    finalValues: Dict[str, Dict[str, Optional[float]]]  # {statement_type: {field: value}}
    corrections: List[CorrectionItem]


class FinalizeResponse(BaseModel):
    success: bool
    sessionId: Optional[str] = None
    companyName: str
    reportingPeriod: str
    finalizedAt: str
    finalOutput: Dict[str, Dict[str, Optional[float]]]
    correctionsCount: int
    flaggedCount: int


# ─── Export ───────────────────────────────────────────────────────────────────

class ExportResponse(BaseModel):
    session_id: str
    csv_content: str
    final_values: Dict[str, Optional[float]]


# ─── Companies ────────────────────────────────────────────────────────────────

class CompanyCreate(BaseModel):
    name: str


class CompanyResponse(BaseModel):
    id: int
    name: str
    markdown_filename: str


# ─── Correction Processing ────────────────────────────────────────────────────

class CorrectionProcessItem(BaseModel):
    field_name: str
    statement_type: str
    layer2_value: Optional[float] = None
    layer2_reasoning: Optional[str] = None
    layer2_validation: Optional[str] = None
    corrected_value: float
    analyst_reasoning: Optional[str] = None
    tag: str  # 'one_off_error' | 'company_specific' | 'general_fix'


class CorrectionProcessRequest(BaseModel):
    company_id: Optional[int] = None
    company_name: str
    period: str
    corrections: List[CorrectionProcessItem]


class CorrectionProcessResponse(BaseModel):
    processed: Dict[str, int]
    general_fix_csv_path: str
    company_specific_queued: int


# ─── Reprocess ────────────────────────────────────────────────────────────────

class ReprocessCorrectionResult(BaseModel):
    correction_id: int
    action: str
    detail: str
    layer_a_instruction: Optional[str] = None


class ReprocessResponse(BaseModel):
    company_id: int
    company_name: str
    corrections_reprocessed: int
    results: List[ReprocessCorrectionResult]
