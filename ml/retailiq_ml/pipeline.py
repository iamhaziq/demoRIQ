"""Orchestration: train, predict and score one shop. No Modal imports, so it runs locally too."""

from __future__ import annotations

import traceback
from datetime import date, datetime, timedelta, timezone
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


MYT = timezone(timedelta(hours=8))


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


# ---- prediction, scoring ------------------------------------------------------------------------

def predict_shop(conn, shop_id: str, models_dir: str | Path, job_id: str | None = None,
                 today: date | None = None) -> dict:
    """Champion -> 28-day daily forecast -> weekly forecasts + decisions -> write back in one transaction.
    Trains first when the shop has no champion yet (a new shop's first upload)."""
    from .decide import build_decisions, build_metrics, forecast_daily
    from .data import latest_stock, load_settings
    from .quantiles import weekly_monday
    from .registry import load_artifacts
    from .writeback import write_results

    today = today or datetime.now(MYT).date()
    set_job(conn, job_id, "running")
    try:
        champion = current_champion(conn, shop_id)
        trained = None
        if champion is None:
            trained = train_shop(conn, shop_id, models_dir)
            champion = current_champion(conn, shop_id)
            if champion is None:
                set_job(conn, job_id, "succeeded")
                return {"shop_id": shop_id, "status": trained.get("status", "no_model")}

        data = load_shop(conn, shop_id)
        panel = build_panel(data.sales, data.stock, data.products)
        if panel.empty:
            set_job(conn, job_id, "succeeded")
            return {"shop_id": shop_id, "status": "no_data"}
        model, _meta = load_artifacts(champion["volume_path"])
        daily = forecast_daily(panel, model, data.holidays)
        as_of = panel["date"].max().date().isoformat()
        settings, stock = load_settings(conn, shop_id), latest_stock(data.stock)
        wape = float(champion["wape"]) if champion.get("wape") is not None else None
        decisions = build_decisions(settings, data.products, stock, daily, as_of, model_wape=wape)
        metrics = build_metrics(settings, data.products, stock, daily, as_of)
        written = write_results(conn, shop_id, champion["id"], weekly_monday(daily), decisions, today,
                                daily=daily, metrics=metrics)

        set_job(conn, job_id, "succeeded")
        return {"shop_id": shop_id, "status": "predicted", "model_version": champion["version"],
                "as_of": as_of, "trained": trained is not None, **written}
    except Exception as e:
        set_job(conn, job_id, "failed", f"{type(e).__name__}: {e}"[:1000])
        traceback.print_exc()
        raise


def score_last_week(conn, shop_id: str, today: date | None = None) -> dict:
    """Last complete Monday week: stored P50 vs actual sales, and 'same as last week' as the baseline.
    Products with a stock-out that week are left out (zero stock is not zero demand)."""
    today = today or datetime.now(MYT).date()
    week = today - timedelta(days=today.weekday() + 7)
    rows = conn.execute(
        """
        with f as (
          select product_id, p50, model_version_id from public.forecasts
          where shop_id = %(s)s and week_start = %(w)s
        ), out_of_stock as (
          select distinct product_id from public.stock_snapshots
          where shop_id = %(s)s and on_hand <= 0 and date between %(w)s and %(w)s::date + 6
        ), actual as (
          select product_id,
                 sum(qty) filter (where date between %(w)s and %(w)s::date + 6) as this_week,
                 sum(qty) filter (where date between %(w)s::date - 7 and %(w)s::date - 1) as last_week
          from public.sales where shop_id = %(s)s and date between %(w)s::date - 7 and %(w)s::date + 6
          group by product_id
        )
        select f.p50::float8, coalesce(a.this_week, 0)::float8, coalesce(a.last_week, 0)::float8,
               f.model_version_id::text
        from f left join actual a using (product_id)
        where f.product_id not in (select product_id from out_of_stock)
        """,
        {"s": shop_id, "w": week},
    ).fetchall()
    if not rows:
        return {"shop_id": shop_id, "week_start": week.isoformat(), "status": "no_forecast"}
    actual = sum(r[1] for r in rows)
    wape = sum(abs(r[0] - r[1]) for r in rows) / actual if actual > 0 else None
    baseline = sum(abs(r[2] - r[1]) for r in rows) / actual if actual > 0 else None
    conn.execute(
        "insert into public.forecast_scores (shop_id, week_start, model_version_id, wape, baseline_wape, products)"
        " values (%s, %s, %s, %s, %s, %s) on conflict (shop_id, week_start) do update set"
        " wape = excluded.wape, baseline_wape = excluded.baseline_wape, products = excluded.products,"
        " model_version_id = excluded.model_version_id, created_at = now()",
        (shop_id, week, rows[0][3], wape, baseline, len(rows)),
    )
    return {"shop_id": shop_id, "week_start": week.isoformat(), "status": "scored", "wape": wape,
            "baseline_wape": baseline, "products": len(rows)}


def worse_than_baseline(conn, weeks: int = 2) -> list[str]:
    """Shops whose live WAPE was worse than the baseline in each of their last `weeks` scored weeks."""
    rows = conn.execute(
        """
        select shop_id::text from (
          select shop_id, wape, baseline_wape,
                 row_number() over (partition by shop_id order by week_start desc) as n
          from public.forecast_scores where wape is not null and baseline_wape is not null
        ) s where n <= %s group by shop_id having count(*) = %s and bool_and(wape > baseline_wape)
        """,
        (weeks, weeks),
    ).fetchall()
    return [r[0] for r in rows]


def run_shop(conn, shop_id: str, models_dir: str | Path, mode: str, job_id: str | None = None) -> dict:
    """Entry point for on-demand jobs: 'predict' (trains first if needed) or 'train_predict'."""
    if mode == "train_predict":
        train_shop(conn, shop_id, models_dir)
        return predict_shop(conn, shop_id, models_dir, job_id=job_id)
    if mode == "predict":
        return predict_shop(conn, shop_id, models_dir, job_id=job_id)
    raise ValueError(f"unknown mode: {mode}")
