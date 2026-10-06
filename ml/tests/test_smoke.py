def test_ml_stack_imports():
    import lightgbm  # noqa: F401
    import pandas  # noqa: F401
    import pyarrow  # noqa: F401
    import sklearn  # noqa: F401
    import statsforecast  # noqa: F401


def test_decisions_package_has_no_io_imports():
    """CLAUDE.md: decisions/ is pure Python, no Modal or database imports."""
    import pathlib

    root = pathlib.Path(__file__).parents[1] / "retailiq_ml" / "decisions"
    for f in root.glob("*.py"):
        text = f.read_text(encoding="utf-8")
        for banned in ("import modal", "import psycopg", "from supabase", "import supabase"):
            assert banned not in text, f"{f.name} imports {banned}"
