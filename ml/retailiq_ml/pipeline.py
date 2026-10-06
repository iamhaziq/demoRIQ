"""Orchestration: train one shop end to end. No Modal imports, so it runs locally too."""

from __future__ import annotations

import traceback
from pathlib import Path

import pandas as pd

from . import forecast
from .baselines import BASELINES, baseline_forecast
from .data import load_shop, set_job
from .evaluate import H, backtest
from .panel import LOW_CONFIDENCE_DAYS, build_panel, history_days
from .registry import (
    LGBM,
    choose_candidate,
    current_champion,
    insert_version,
    next_version,
    promote,
    save_artifacts,
    should_promote,
)


def predict_all_models(holidays: pd.DataFrame):
    """predict_fn for the backtest: every baseline plus LightGBM (skipped if history is too short)."""

    def predict_fn(train: pd.DataFrame, h: int) -> pd.DataFrame:
        out = baseline_forecast(train, h)
        try:
            lg = forecast.predict(forecast.fit(train, holidays), train, holidays, h)
            out = out.merge(lg[["product_id", "date", "p50"]].rename(columns={"p50": LGBM}),
                            on=["product_id", "date"], how="left")
        except ValueError:
            pass  # not enough history for LightGBM in this window
        return out

    return predict_fn


def train_shop(conn, shop_id: str, models_dir: str | Path, job_id: str | None = None,
               as_of: str | None = None) -> dict:
    """Snapshot data -> backtest LightGBM and baselines -> save the candidate -> insert a
    model_versions row -> promote it if it beats the champion by 5% WAPE."""
    set_job(conn, job_id, "running")
    try:
        data = load_shop(conn, shop_id)
        panel = build_panel(data.sales, data.stock, data.products, as_of)
        if panel.empty:
            set_job(conn, job_id, "succeeded")
            return {"shop_id": shop_id, "status": "no_data"}

        bt = backtest(panel, predict_all_models(data.holidays))
        model_type, wape, baseline_wape = choose_candidate(bt.scores)
        model = forecast.fit(panel, data.holidays) if model_type == LGBM else model_type
        as_of_date = panel["date"].max()
        hist = history_days(panel, as_of_date)

        version = next_version(conn, shop_id)
        meta = {
            "shop_id": shop_id,
            "version": version,
            "model_type": model_type,
            "trained_through": as_of_date.date().isoformat(),
            "horizon_days": H,
            "features": forecast.FEATURES if model_type == LGBM else [],
            "params": forecast.PARAMS if model_type == LGBM else {},
            "backtest": {"scores": bt.scores, "windows": bt.windows, "products": bt.products},
            "low_confidence_products": sorted(hist.index[hist < LOW_CONFIDENCE_DAYS]),
        }
        vdir = save_artifacts(models_dir, shop_id, version, model, meta)

        # The exact data this version was trained on, so every version is reproducible.
        snap = vdir / "data"
        snap.mkdir(exist_ok=True)
        data.sales.to_parquet(snap / "sales.parquet", index=False)
        data.stock.to_parquet(snap / "stock.parquet", index=False)
        data.products.to_parquet(snap / "products.parquet", index=False)

        champion = current_champion(conn, shop_id)
        version_id = insert_version(
            conn, shop_id, version, model_type, str(vdir), str(snap), wape, baseline_wape,
            {"scores": bt.scores, "windows": bt.windows, "products": bt.products,
             "baselines": list(BASELINES), "trained_through": meta["trained_through"]},
        )
        promoted = should_promote(wape, champion)
        if promoted:
            promote(conn, shop_id, version_id)

        set_job(conn, job_id, "succeeded")
        return {
            "shop_id": shop_id,
            "status": "trained",
            "version": version,
            "model_type": model_type,
            "wape": wape,
            "baseline_wape": baseline_wape,
            "scores": bt.scores,
            "promoted": promoted,
            "previous_champion": champion and {"version": champion["version"], "wape": champion["wape"]},
        }
    except Exception as e:
        set_job(conn, job_id, "failed", f"{type(e).__name__}: {e}"[:1000])
        traceback.print_exc()
        raise
