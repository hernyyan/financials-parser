"""
Database connection and setup using SQLAlchemy.
Supports PostgreSQL (primary) and SQLite (fallback for local testing).
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from app.config import DATABASE_URL

_IS_SQLITE = DATABASE_URL.startswith("sqlite")

connect_args = {}
if _IS_SQLITE:
    connect_args["check_same_thread"] = False

engine = create_engine(DATABASE_URL, connect_args=connect_args)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ── SQLite CREATE TABLE statements ────────────────────────────────────────────

_SQLITE_CREATE_REVIEWS = """
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE,
    company_name TEXT NOT NULL,
    reporting_period TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finalized_at TIMESTAMP,
    status TEXT DEFAULT 'in_progress',
    layer1_data JSON,
    layer2_data JSON,
    final_output JSON,
    corrections JSON
);
"""

_SQLITE_CREATE_COMPANIES = """
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    markdown_filename TEXT NOT NULL
);
"""

_SQLITE_CREATE_CORRECTIONS = """
CREATE TABLE IF NOT EXISTS company_specific_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    company_name TEXT NOT NULL,
    period TEXT NOT NULL,
    statement_type TEXT NOT NULL,
    field_name TEXT NOT NULL,
    layer2_value REAL,
    layer2_reasoning TEXT,
    layer2_validation TEXT,
    corrected_value REAL NOT NULL,
    analyst_reasoning TEXT,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
);
"""

_SQLITE_CREATE_IS_TAB_CONFIGS = """
CREATE TABLE IF NOT EXISTS is_tab_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL UNIQUE,
    config JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
);
"""

_SQLITE_CREATE_STATEMENT_TAB_CONFIGS = """
CREATE TABLE IF NOT EXISTS statement_tab_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    statement_type TEXT NOT NULL,
    config JSON NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, statement_type)
);
"""

# ── PostgreSQL CREATE TABLE statements ────────────────────────────────────────

_PG_CREATE_REVIEWS = """
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    session_id TEXT UNIQUE,
    company_name TEXT NOT NULL,
    reporting_period TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    finalized_at TIMESTAMP,
    status TEXT DEFAULT 'in_progress',
    layer1_data JSONB,
    layer2_data JSONB,
    final_output JSONB,
    corrections JSONB
);
"""

_PG_CREATE_COMPANIES = """
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    markdown_filename TEXT NOT NULL
);
"""

_PG_CREATE_CORRECTIONS = """
CREATE TABLE IF NOT EXISTS company_specific_corrections (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL,
    company_name TEXT NOT NULL,
    period TEXT NOT NULL,
    statement_type TEXT NOT NULL,
    field_name TEXT NOT NULL,
    layer2_value REAL,
    layer2_reasoning TEXT,
    layer2_validation TEXT,
    corrected_value REAL NOT NULL,
    analyst_reasoning TEXT,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (company_id) REFERENCES companies(id)
);
"""

_PG_CREATE_IS_TAB_CONFIGS = """
CREATE TABLE IF NOT EXISTS is_tab_configs (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL UNIQUE,
    config JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (company_id) REFERENCES companies(id)
);
"""

_PG_CREATE_STATEMENT_TAB_CONFIGS = """
CREATE TABLE IF NOT EXISTS statement_tab_configs (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL,
    statement_type TEXT NOT NULL,
    config JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, statement_type)
);
"""

# ── Idempotent migrations for pre-existing databases ─────────────────────────

_MIGRATIONS = [
    "ALTER TABLE reviews ADD COLUMN session_id TEXT UNIQUE;",
    "ALTER TABLE reviews ADD COLUMN finalized_at TIMESTAMP;",
    "ALTER TABLE reviews ADD COLUMN company_id INTEGER;",
]


def init_db() -> None:
    """Create database tables if they do not exist. Also runs safe migrations."""
    if _IS_SQLITE:
        create_reviews = _SQLITE_CREATE_REVIEWS
        create_companies = _SQLITE_CREATE_COMPANIES
        create_corrections = _SQLITE_CREATE_CORRECTIONS
        create_is_tab_configs = _SQLITE_CREATE_IS_TAB_CONFIGS
        create_statement_tab_configs = _SQLITE_CREATE_STATEMENT_TAB_CONFIGS
    else:
        create_reviews = _PG_CREATE_REVIEWS
        create_companies = _PG_CREATE_COMPANIES
        create_corrections = _PG_CREATE_CORRECTIONS
        create_is_tab_configs = _PG_CREATE_IS_TAB_CONFIGS
        create_statement_tab_configs = _PG_CREATE_STATEMENT_TAB_CONFIGS

    with engine.connect() as conn:
        conn.execute(text(create_reviews))
        conn.execute(text(create_companies))
        conn.execute(text(create_corrections))
        conn.execute(text(create_is_tab_configs))
        conn.execute(text(create_statement_tab_configs))
        for migration in _MIGRATIONS:
            try:
                conn.execute(text(migration))
            except Exception:
                pass  # Column already exists
        conn.commit()


def get_db():
    """FastAPI dependency that yields a database session."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
