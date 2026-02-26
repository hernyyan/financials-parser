"""
GET /template — Serve the firm's standardized template structure.
Returns field ordering and section groupings for both statements.
"""
from fastapi import APIRouter

from app.models.schemas import TemplateResponse
from app.services.template_service import get_template_service

router = APIRouter()


@router.get("/template", response_model=TemplateResponse)
def get_template():
    """
    Return the template field order and section headers for both statements.
    The frontend uses this to render the right-panel classification table in the
    correct order with proper section dividers.
    """
    service = get_template_service()
    return service.get_template_structure()
