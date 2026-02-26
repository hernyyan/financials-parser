"""
SQLAlchemy ORM models for the Financial Analysis Platform.
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, JSON, Text
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Review(Base):
    """
    Stores a complete financial statement review session.
    Captures all Layer 1/2 outputs, corrections, and the final approved values.
    """
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_name = Column(String, nullable=False)
    reporting_period = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="in_progress")  # in_progress | finalized
    layer1_data = Column(JSON, nullable=True)        # raw Layer 1 output per sheet
    layer2_data = Column(JSON, nullable=True)        # raw Layer 2 output per statement type
    final_output = Column(JSON, nullable=True)       # final approved field values
    corrections = Column(JSON, nullable=True)        # array of Correction objects

    def __repr__(self) -> str:
        return f"<Review id={self.id} company='{self.company_name}' period='{self.reporting_period}'>"
