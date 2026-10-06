"""Write forecasts and decisions back to Supabase as ml_worker, in one transaction per shop."""

from __future__ import annotations

import json
from datetime import date

import pandas as pd


def write_results(conn, shop_id: str, model_version_id: str, weekly: pd.DataFrame, decisions: list[dict],
                  today: date, daily: pd.DataFrame | None = None, metrics: list[dict] | None = None) -> dict:
    """
    forecasts: weeks that have not started (week_start > today) are replaced; a week that has started
    is only inserted if missing and otherwise never touched, so live scoring compares against the
    forecast made before the week began.
    decisions: current rows are marked superseded (feedback keeps pointing at them), new rows inserted.
    forecast_daily and product_metrics (what the app screens show): replaced for the shop.
    """
    future = weekly[weekly["week_start"].dt.date > today]
    started = weekly[weekly["week_start"].dt.date <= today]
    row = lambda r: (shop_id, r.product_id, model_version_id, r.week_start.date(),  # noqa: E731
                     round(r.p10, 3), round(r.p50, 3), round(r.p90, 3), bool(r.low_confidence))
    insert = ("insert into public.forecasts"
              " (shop_id, product_id, model_version_id, week_start, p10, p50, p90, low_confidence)"
              " values (%s, %s, %s, %s, %s, %s, %s, %s)")

    with conn.transaction():
        conn.execute("delete from public.forecasts where shop_id = %s and week_start > %s", (shop_id, today))
        with conn.cursor() as cur:
            cur.executemany(insert, [row(r) for r in future.itertuples()])
            cur.executemany(insert + " on conflict (shop_id, product_id, week_start) do nothing",
                            [row(r) for r in started.itertuples()])
        superseded = conn.execute(
            "update public.decisions set superseded_at = now() where shop_id = %s and superseded_at is null",
            (shop_id,),
        ).rowcount
        with conn.cursor() as cur:
            cur.executemany(
                "insert into public.decisions (shop_id, product_id, model_version_id, type, qty, value_rm, reason_json)"
                " values (%s, %s, %s, %s, %s, %s, %s)",
                [(shop_id, d["product_id"], model_version_id, d["type"], d["qty"], d["value_rm"],
                  json.dumps(d["reason_json"], default=str)) for d in decisions],
            )
        if daily is not None:
            conn.execute("delete from public.forecast_daily where shop_id = %s", (shop_id,))
            with conn.cursor() as cur:
                cur.executemany(
                    "insert into public.forecast_daily (shop_id, product_id, model_version_id, date, p10, p50, p90,"
                    " low_confidence) values (%s, %s, %s, %s, %s, %s, %s, %s)",
                    [(shop_id, r.product_id, model_version_id, r.date.date(), round(r.p10, 3), round(r.p50, 3),
                      round(r.p90, 3), bool(r.low_confidence)) for r in daily.itertuples()],
                )
        if metrics is not None:
            cols = ["product_id", "as_of", "on_hand", "stock_value", "days_of_cover", "age_days", "cost_components",
                    "annual_cost", "carrying_rate", "cost_per_day", "cost_30d", "cost_180d", "forecast_p10",
                    "forecast_p50", "forecast_p90", "low_confidence", "slow_stock"]
            conn.execute("delete from public.product_metrics where shop_id = %s", (shop_id,))
            with conn.cursor() as cur:
                cur.executemany(
                    f"insert into public.product_metrics (shop_id, model_version_id, {', '.join(cols)})"
                    f" values (%s, %s, {', '.join(['%s'] * len(cols))})",
                    [(shop_id, model_version_id, *[json.dumps(m[c]) if c == "cost_components" else m[c] for c in cols])
                     for m in metrics],
                )
    return {"forecast_weeks": len(future) + len(started), "decisions": len(decisions), "superseded": superseded,
            "daily_rows": 0 if daily is None else len(daily), "products": 0 if metrics is None else len(metrics)}
