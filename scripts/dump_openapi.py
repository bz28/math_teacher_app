"""Dump the FastAPI OpenAPI spec to mobile/openapi.json.

The mobile API client generates its TypeScript types from this file
(see mobile/package.json `gen:api`), so the client types derive from the
backend Pydantic schemas instead of being hand-maintained — contract
drift becomes a compile error. Importing the app is enough; no DB needed.

Usage: python -m scripts.dump_openapi
"""

import json
import pathlib

from api.main import app

OUT = pathlib.Path(__file__).resolve().parent.parent / "mobile" / "openapi.json"


def main() -> None:
    spec = app.openapi()
    OUT.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n")
    print(f"wrote {OUT} ({len(spec.get('paths', {}))} paths, "
          f"{len(spec.get('components', {}).get('schemas', {}))} schemas)")


if __name__ == "__main__":
    main()
