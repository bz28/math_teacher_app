"""Guard: every api/models/*.py must be imported by api.models.__init__.

If a new model module is added but not imported in __init__, its table is
absent from Base.metadata (target_metadata). `alembic revision --autogenerate`
would then compare the live DB against a metadata missing that table and emit
DROP TABLE for it — a data-loss footgun. This test fails the moment a model
file drifts out of __init__, before it can reach a migration.
"""

import pkgutil
import sys

import api.models  # noqa: F401  (registers all model modules)


def test_all_model_modules_imported() -> None:
    file_modules = {
        name
        for _, name, ispkg in pkgutil.iter_modules(api.models.__path__)
        if not ispkg and not name.startswith("_")
    }
    imported = {
        name.split(".")[-1]
        for name in sys.modules
        if name.startswith("api.models.") and name.count(".") == 2
    }
    missing = file_modules - imported
    assert not missing, (
        "These api/models/*.py modules are NOT imported in api/models/__init__.py: "
        f"{sorted(missing)}. Their tables would be missing from Base.metadata and "
        "`alembic revision --autogenerate` would emit DROP TABLE for them. "
        "Add them to api/models/__init__.py."
    )


def test_models_register_tables_on_metadata() -> None:
    """Sanity: importing api.models registers the previously-missing tables."""
    from api.database import Base

    tables = set(Base.metadata.tables)
    for critical in (
        "question_bank_items",
        "integrity_check_submissions",
        "activity_log",
    ):
        assert critical in tables, (
            f"{critical} is not registered on Base.metadata — autogenerate would "
            "drop it. Ensure its model module is imported in api/models/__init__.py."
        )
