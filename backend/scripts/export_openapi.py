"""Write the API's OpenAPI schema to a file (used to generate the frontend types)."""

import json
import sys
from pathlib import Path

from api.main import app

out = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
out.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
print(f"wrote {out}")
