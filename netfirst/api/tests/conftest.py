"""Tests read their config from .env.example (the single source of defaults) and use a throwaway SQLite file."""
import os
import tempfile
from pathlib import Path

import pytest
from dotenv import dotenv_values

for key, value in dotenv_values(Path(__file__).parents[2] / ".env.example").items():
    os.environ[key] = value or ""
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"

from sqlmodel import Session, SQLModel  # noqa: E402

from app.models import engine  # noqa: E402


@pytest.fixture
def s():
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
