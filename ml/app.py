"""RetailIQ Modal app. All ML workloads run here; results are written back to Supabase."""

import modal

app = modal.App("retailiq-ml")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "pandas", "numpy", "pyarrow", "lightgbm", "scikit-learn", "scipy", "statsforecast",
        "psycopg[binary]", "supabase"
    )
    .add_local_python_source("retailiq_ml")
)


@app.function(image=image)
def hello(name: str = "RetailIQ") -> str:
    from retailiq_ml import greeting

    return greeting(name)


@app.local_entrypoint()
def main(name: str = "RetailIQ"):
    print(hello.remote(name))
