"""RetailIQ Modal app. All ML workloads run here; results are written back to Supabase.
Thin wrappers only: the logic lives in retailiq_ml.pipeline so it also runs locally."""

import modal

app = modal.App("retailiq-ml")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "pandas", "numpy", "pyarrow", "lightgbm", "scikit-learn", "scipy", "statsforecast",
        "psycopg[binary]",
    )
    .add_local_python_source("retailiq_ml")
)
models = modal.Volume.from_name("retailiq-models", create_if_missing=True)
# retailiq-supabase holds DATABASE_URL: the ml_worker connection string (Supavisor pooler).
secrets = [modal.Secret.from_name("retailiq-supabase")]


@app.function(image=image, volumes={"/models": models}, secrets=secrets, timeout=1800)
def train_shop(shop_id: str, job_id: str | None = None) -> dict:
    from retailiq_ml.data import connect
    from retailiq_ml.pipeline import train_shop as run

    with connect() as conn:
        try:
            return run(conn, shop_id, "/models", job_id=job_id)
        finally:
            models.commit()
