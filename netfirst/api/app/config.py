"""All tunables come from the environment; .env.example is the only list of defaults."""
import os
from decimal import Decimal

from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv(usecwd=True))


class _Env:
    """env.KEY returns the raw string and fails loudly when it is missing or blank."""

    def __getattr__(self, key: str) -> str:
        value = os.environ.get(key)
        if not value:
            raise RuntimeError(f"{key} is not set (see .env.example)")
        return value

    def int(self, key: str) -> int:
        return int(getattr(self, key))

    def dec(self, key: str) -> Decimal:
        return Decimal(getattr(self, key))

    def list(self, key: str) -> list[str]:
        return [s.strip() for s in getattr(self, key).split(",") if s.strip()]


env = _Env()
