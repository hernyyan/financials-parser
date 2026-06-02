"""
Database connection and setup using SQLAlchemy.
Supports PostgreSQL (primary) and SQLite (fallback for local testing).

Postgres auth modes (controlled by DB_AUTH_MODE):
  - "password": credentials baked into DATABASE_URL (default; used locally)
  - "entra":    fresh Microsoft Entra access token injected per new connection
                using DefaultAzureCredential. Pool is tuned to recycle
                connections before the 1-hour token TTL expires.
"""
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import sessionmaker, Session
from app.config import DATABASE_URL, DB_AUTH_MODE

_IS_SQLITE = DATABASE_URL.startswith("sqlite")
_USE_ENTRA = (not _IS_SQLITE) and DB_AUTH_MODE == "entra"

# Azure Database for PostgreSQL Entra token audience.
_ENTRA_SCOPE = "https://ossrdbms-aad.database.windows.net/.default"

connect_args = {}
if _IS_SQLITE:
    connect_args["check_same_thread"] = False

if _USE_ENTRA:
    # Strip any embedded password from the URL — the token listener supplies it.
    _url = make_url(DATABASE_URL).set(password=None)
    engine = create_engine(
        _url,
        connect_args=connect_args,
        pool_pre_ping=True,
        pool_recycle=1800,  # rotate connections well before the ~1h token TTL
    )

    # Lazy import so non-Azure environments don't need azure-identity installed.
    from azure.identity import DefaultAzureCredential

    _credential = DefaultAzureCredential()

    @event.listens_for(engine, "do_connect")
    def _inject_entra_token(dialect, conn_rec, cargs, cparams):
        cparams["password"] = _credential.get_token(_ENTRA_SCOPE).token
else:
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
    context TEXT DEFAULT ''
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

_SQLITE_CREATE_LAYER1_TEMPLATES = """
CREATE TABLE IF NOT EXISTS layer1_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    statement_type TEXT NOT NULL,
    template JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, statement_type)
);
"""

_SQLITE_CREATE_EXTRACTION_JOBS = """
CREATE TABLE IF NOT EXISTS extraction_jobs (
    job_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    context TEXT DEFAULT ''
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

_PG_CREATE_LAYER1_TEMPLATES = """
CREATE TABLE IF NOT EXISTS layer1_templates (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL,
    statement_type TEXT NOT NULL,
    template JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE(company_id, statement_type)
);
"""

_PG_CREATE_EXTRACTION_JOBS = """
CREATE TABLE IF NOT EXISTS extraction_jobs (
    job_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
"""

# ── Idempotent migrations for pre-existing databases ─────────────────────────

_MIGRATIONS = [
    "ALTER TABLE reviews ADD COLUMN session_id TEXT UNIQUE;",
    "ALTER TABLE reviews ADD COLUMN finalized_at TIMESTAMP;",
    "ALTER TABLE reviews ADD COLUMN company_id INTEGER;",
    "ALTER TABLE companies ADD COLUMN context TEXT DEFAULT '';",
    # Drop the old over-broad index (company_id IS NOT NULL only) if it exists,
    # then recreate scoped to finalized rows only. Both steps are idempotent.
    "ALTER TABLE companies ADD COLUMN tab_preferences TEXT DEFAULT NULL;",
    "DROP INDEX IF EXISTS idx_reviews_company_period;",
    # Partial unique index: prevents two *finalized* rows for the same company+period.
    # In-progress rows (multiple upload attempts) are intentionally excluded.
    # NULL company_id rows are also excluded so legacy data doesn't violate it.
    # Supported by both SQLite 3.8+ and PostgreSQL.
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_company_period ON reviews(company_id, reporting_period) WHERE company_id IS NOT NULL AND final_output IS NOT NULL;",
]


def _exec_safe(ddl: str) -> None:
    """
    Execute a single DDL statement in its own transaction.

    Each statement gets an isolated connection so that a failure (e.g. a
    migration ALTER TABLE whose column already exists) cannot abort the
    transaction that contains unrelated CREATE TABLE statements.
    """
    with engine.connect() as conn:
        try:
            conn.execute(text(ddl))
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def init_db() -> None:
    """Create database tables if they do not exist. Also runs safe migrations."""
    if _IS_SQLITE:
        ddl_statements = [
            _SQLITE_CREATE_REVIEWS,
            _SQLITE_CREATE_COMPANIES,
            _SQLITE_CREATE_CORRECTIONS,
            _SQLITE_CREATE_LAYER1_TEMPLATES,
            _SQLITE_CREATE_EXTRACTION_JOBS,
        ]
    else:
        ddl_statements = [
            _PG_CREATE_REVIEWS,
            _PG_CREATE_COMPANIES,
            _PG_CREATE_CORRECTIONS,
            _PG_CREATE_LAYER1_TEMPLATES,
            _PG_CREATE_EXTRACTION_JOBS,
        ]

    # Each CREATE TABLE runs in its own transaction so a failed migration
    # on the same connection cannot roll it back.
    for ddl in ddl_statements:
        _exec_safe(ddl)

    # Migrations are best-effort: failure means the column already exists.
    for migration in _MIGRATIONS:
        try:
            _exec_safe(migration)
        except Exception:
            pass  # Column already exists — safe to ignore


def get_db():
    """FastAPI dependency that yields a database session."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
