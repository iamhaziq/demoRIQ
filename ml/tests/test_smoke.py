from retailiq_ml import greeting


def test_greeting():
    assert greeting("Kedai Ali") == "Hello from retailiq-ml, Kedai Ali"


def test_ml_stack_imports():
    import lightgbm  # noqa: F401
    import pandas  # noqa: F401
    import pyarrow  # noqa: F401
    import statsforecast  # noqa: F401
