"""Seed 4 demo scenario clients — standalone entry point. Delegates to app.scripts.seed."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.scripts.seed import seed_session
from app.models import init_db

if __name__ == "__main__":
    init_db()
    sid = sys.argv[1] if len(sys.argv) > 1 else "demo-seed-01"
    seed_session(sid)
    print(f"Seeded session {sid}")
