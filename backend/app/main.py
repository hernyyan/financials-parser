"""
FastAPI application entry point.
Sets up CORS, mounts routers, and initializes the database.
"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import PROCESSED_DIR
from app.db.database import init_db
from app.routes import upload, layer1, layer2, corrections, finalize, template, export, companies
from app.services.claude_service import load_prompts
from app.services.template_service import get_template_service

app = FastAPI(
    title="Financial Analysis Platform API",
    description="Backend API for automated portfolio company financial statement processing.",
    version="0.1.0",
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    print(f"422 VALIDATION ERROR on {request.method} {request.url.path}")
    print(f"  errors: {exc.errors()}")
    try:
        body = await request.body()
        print(f"  raw body: {body[:500]}")
    except Exception:
        pass
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


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

# StaticFiles mount registered last so router routes take precedence
app.mount("/files", StaticFiles(directory=str(PROCESSED_DIR)), name="files")


@app.on_event("startup")
async def startup_event():
    """Initialize database tables, load prompt files, and parse template on startup."""
    init_db()
    load_prompts()          # Cache AI prompts from backend/prompts/
    get_template_service()  # Parse loader_template.csv into memory


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.1.0"}
