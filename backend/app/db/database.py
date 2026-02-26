"""
SQLite database connection and setup using SQLAlchemy.
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from app.config import DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # Required for SQLite
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

CREATE_REVIEWS_TABLE = """
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

CREATE_COMPANIES_TABLE = """
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    markdown_filename TEXT NOT NULL
);
"""

CREATE_COMPANY_SPECIFIC_CORRECTIONS_TABLE = """
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

# Idempotent migrations for pre-existing databases
_MIGRATIONS = [
    "ALTER TABLE reviews ADD COLUMN session_id TEXT UNIQUE;",
    "ALTER TABLE reviews ADD COLUMN finalized_at TIMESTAMP;",
    "ALTER TABLE reviews ADD COLUMN company_id INTEGER;",
]


def init_db() -> None:
    """Create database tables if they do not exist. Also runs safe migrations."""
    with engine.connect() as conn:
        conn.execute(text(CREATE_REVIEWS_TABLE))
        conn.execute(text(CREATE_COMPANIES_TABLE))
        conn.execute(text(CREATE_COMPANY_SPECIFIC_CORRECTIONS_TABLE))
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
