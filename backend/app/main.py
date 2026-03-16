"""
FastAPI application entry point.
Sets up CORS, mounts routers, and initializes the database.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

from app.config import PROCESSED_DIR
from app.db.database import init_db
from app.routes import upload, layer1, layer2, corrections, finalize, template, export, companies, admin
from app.routes.layer1_pdf import router as layer1_pdf_router
from app.routes.datasets import router as datasets_router
from app.services.claude_service import load_prompts
from app.services.template_service import get_template_service

app = FastAPI(
    title="Financial Analysis Platform API",
    description="Backend API for automated portfolio company financial statement processing.",
    version="0.1.0",
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning("422 VALIDATION ERROR on %s %s: %s", request.method, request.url.path, exc.errors())
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


# CORS — allow the Vite dev server origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers first — specific routes must be registered before the
# StaticFiles mount, otherwise the mount's prefix match wins for /files/...
app.include_router(upload.router)
app.include_router(layer1.router)
app.include_router(layer2.router)
app.include_router(corrections.router)
app.include_router(finalize.router)
app.include_router(template.router)
app.include_router(export.router)
app.include_router(companies.router)
app.include_router(admin.router)
app.include_router(layer1_pdf_router)
app.include_router(datasets_router)

# StaticFiles mount registered last so router routes take precedence
app.mount("/files", StaticFiles(directory=str(PROCESSED_DIR)), name="files")


@app.on_event("startup")
async def startup_event():
    """Initialize database tables, load prompt files, and parse template on startup."""
    try:
        init_db()
        load_prompts()          # Cache AI prompts from backend/prompts/
        get_template_service()  # Parse loader_template.csv into memory
    except Exception as exc:
        logger.critical("Startup failed: %s", exc)
        raise


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.1.0"}
