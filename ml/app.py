"""RetailIQ Modal app. All ML workloads run here; results are written back to Supabase.
Thin wrappers only: the logic lives in retailiq_ml.pipeline so it also runs locally.

Secrets: retailiq-supabase (DATABASE_URL, the ml_worker connection string via the Supavisor pooler),
retailiq-alerts (RESEND_API_KEY, ALERT_EMAIL). The web endpoint requires a Modal proxy auth token,
held only by the trigger-ml Edge Function.
"""

import modal

app = modal.App("retailiq-ml")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "pandas", "numpy", "pyarrow", "lightgbm", "scikit-learn", "scipy", "statsforecast",
        "psycopg[binary]", "fastapi[standard]",
    )
    .add_local_python_source("retailiq_ml")
)
models = modal.Volume.from_name("retailiq-models", create_if_missing=True)
secrets = [modal.Secret.from_name("retailiq-supabase"), modal.Secret.from_name("retailiq-alerts")]
fn = dict(image=image, volumes={"/models": models}, secrets=secrets)
TZ = "Asia/Kuala_Lumpur"


def _with_conn(work):
    from retailiq_ml.data import connect

    with connect() as conn:
        try:
            return work(conn)
        finally:
            models.commit()


@app.function(**fn, timeout=1800)
def train_shop(shop_id: str, job_id: str | None = None) -> dict:
    from retailiq_ml import pipeline

    return _with_conn(lambda c: pipeline.train_shop(c, shop_id, "/models", job_id=job_id))


@app.function(**fn, timeout=900)
def predict_shop(shop_id: str, job_id: str | None = None) -> dict:
    from retailiq_ml import pipeline

    models.reload()  # see the latest trained versions
    return _with_conn(lambda c: pipeline.predict_shop(c, shop_id, "/models", job_id=job_id))


@app.function(**fn, timeout=2400)
def run_shop(shop_id: str, mode: str, job_id: str | None = None) -> dict:
    from retailiq_ml import pipeline

    models.reload()
    return _with_conn(lambda c: pipeline.run_shop(c, shop_id, "/models", mode, job_id=job_id))


@app.function(**fn, timeout=300)
def score_shop(shop_id: str) -> dict:
    from retailiq_ml import pipeline
    from retailiq_ml.data import connect

    with connect() as conn:
        return pipeline.score_last_week(conn, shop_id)


def _for_all_shops(job: str, worker) -> list:
    """One call per shop; one bad shop never stops the others. Emails a summary of failures."""
    from retailiq_ml.alerts import batch_report, send_alert
    from retailiq_ml.data import active_shops, connect

    with connect() as conn:
        shop_ids = active_shops(conn)
    results = list(worker.map(shop_ids, return_exceptions=True))
    report = batch_report(job, shop_ids, results)
    if report:
        send_alert(*report)
    return [r if not isinstance(r, BaseException) else {"error": repr(r)[:300]} for r in results]


@app.function(**fn, timeout=3600, schedule=modal.Cron("0 2 * * *", timezone=TZ))
def predict_all() -> list:
    """Nightly, 2 am Malaysia time: forecast 28 days and refresh decisions for every active shop."""
    return _for_all_shops("Nightly prediction", predict_shop)


@app.function(**fn, timeout=3600, schedule=modal.Cron("0 1 * * 0", timezone=TZ))
def train_all() -> list:
    """Sunday 1 am (before that night's prediction): train a challenger per shop, promote if it wins."""
    return _for_all_shops("Weekly training", train_shop)


@app.function(**fn, timeout=1800, schedule=modal.Cron("0 3 * * 1", timezone=TZ))
def score_all() -> list:
    """Monday 3 am: score last week's forecasts; alert on shops worse than the baseline 2 weeks running."""
    from retailiq_ml import pipeline
    from retailiq_ml.alerts import send_alert
    from retailiq_ml.data import connect

    results = _for_all_shops("Weekly scoring", score_shop)
    with connect() as conn:
        bad = pipeline.worse_than_baseline(conn, weeks=2)
    if bad:
        send_alert(f"{len(bad)} shop(s) worse than baseline for 2 weeks",
                   [f"- shop {s}" for s in bad] + ["Check the shop's data or roll back its model version."])
    return results


@app.function(image=image, timeout=30)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def jobs(body: dict) -> dict:
    """Start a job and return immediately. Called only by the trigger-ml Edge Function (proxy auth).
    Body: {"shop_id": uuid, "job_id": uuid, "mode": "predict" | "train_predict"}."""
    import uuid

    from fastapi import HTTPException

    try:
        shop_id, job_id = str(uuid.UUID(body["shop_id"])), str(uuid.UUID(body["job_id"]))
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=422, detail="shop_id and job_id must be UUIDs") from None
    mode = body.get("mode", "predict")
    if mode not in ("predict", "train_predict"):
        raise HTTPException(status_code=422, detail="mode must be predict or train_predict")
    call = run_shop.spawn(shop_id, mode, job_id)
    return {"call_id": call.object_id}
