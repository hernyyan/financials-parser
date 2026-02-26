"""
Application configuration — loads from .env with sensible defaults.
All paths and model names are configurable so they can be swapped without code changes.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(override=True)

# Base paths
BASE_DIR = Path(__file__).resolve().parent.parent  # backend/

# Anthropic API
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

# Model names (swap between Sonnet and Opus without code changes)
LAYER1_MODEL: str = os.getenv("LAYER1_MODEL", "claude-sonnet-4-6")
LAYER2_MODEL: str = os.getenv("LAYER2_MODEL", "claude-opus-4-6")
LAYER_A_MODEL: str = os.getenv("LAYER_A_MODEL", "claude-sonnet-4-6")
LAYER_B_MODEL: str = os.getenv("LAYER_B_MODEL", "claude-opus-4-6")

# Directory paths
UPLOADS_DIR: Path = BASE_DIR / os.getenv("UPLOADS_DIR", "uploads")
PROCESSED_DIR: Path = BASE_DIR / os.getenv("PROCESSED_DIR", "processed")
PROMPTS_DIR: Path = BASE_DIR / os.getenv("PROMPTS_DIR", "prompts")
TEMPLATES_DIR: Path = BASE_DIR / os.getenv("TEMPLATES_DIR", "templates")

# Database
DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'financial_platform.db'}")

# CORS origins
CORS_ORIGINS: list[str] = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

COMPANY_CONTEXT_DIR: Path = BASE_DIR / os.getenv("COMPANY_CONTEXT_DIR", "company_context")
DATA_DIR: Path = BASE_DIR / os.getenv("DATA_DIR", "data")

# Ensure required directories exist
for _dir in [UPLOADS_DIR, PROCESSED_DIR, PROMPTS_DIR, TEMPLATES_DIR, COMPANY_CONTEXT_DIR, DATA_DIR]:
    _dir.mkdir(parents=True, exist_ok=True)
