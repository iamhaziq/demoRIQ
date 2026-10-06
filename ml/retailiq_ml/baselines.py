"""Baseline forecasts with statsforecast: the safety net and the bar LightGBM must beat."""

from __future__ import annotations

import numpy as np
import pandas as pd
from statsforecast import StatsForecast
from statsforecast.models import ADIDA, AutoETS, CrostonOptimized, SeasonalNaive, WindowAverage

from .panel import demand

BASELINES = ("seasonal_naive", "window_avg_28", "auto_ets", "croston", "adida")
MIN_POINTS = 14  # shorter or all-zero series get the recent average for every baseline


def _models(names) -> list:
    make = {
        "seasonal_naive": lambda: SeasonalNaive(season_length=7, alias="seasonal_naive"),
        "window_avg_28": lambda: WindowAverage(window_size=28, alias="window_avg_28"),
        "auto_ets": lambda: AutoETS(season_length=7, alias="auto_ets"),
        "croston": lambda: CrostonOptimized(alias="croston"),
        "adida": lambda: ADIDA(alias="adida"),
    }
    return [make[n]() for n in names]


def filled_demand(panel: pd.DataFrame) -> pd.Series:
    """Demand with stock-out days replaced by the product's median of the previous 28 days
    (statsforecast needs complete series). Falls back to 0 when there is no history yet."""
    y = demand(panel)
    med = y.groupby(panel["product_id"]).transform(lambda s: s.rolling(28, min_periods=1).median().shift(1))
    return y.fillna(med).fillna(0.0)


def _future_dates(panel: pd.DataFrame, h: int) -> pd.DatetimeIndex:
    as_of = panel["date"].max()
    return pd.date_range(as_of + pd.Timedelta(days=1), periods=h, freq="D")


def recent_average(panel: pd.DataFrame, h: int, window: int = 28) -> pd.DataFrame:
    """Mean demand over each product's last `window` days (stock-outs skipped), held flat.
    Used for low-confidence products. Returns product_id, date, p50."""
    as_of = panel["date"].max()
    recent = panel[panel["date"] > as_of - pd.Timedelta(days=window)].copy()
    recent["y"] = demand(recent)
    mean = recent.groupby("product_id")["y"].mean().fillna(0.0)
    dates = _future_dates(panel, h)
    return pd.DataFrame(
        [(pid, d, float(m)) for pid, m in mean.items() for d in dates], columns=["product_id", "date", "p50"]
    )


def baseline_forecast(panel: pd.DataFrame, h: int = 28, names=BASELINES) -> pd.DataFrame:
    """Point forecasts for every baseline. Returns product_id, date, <one column per baseline>."""
    names = list(names)
    df = pd.DataFrame({"unique_id": panel["product_id"], "ds": panel["date"], "y": filled_demand(panel)})
    stats = df.groupby("unique_id")["y"].agg(["size", "sum"])
    fit_ids = stats.index[(stats["size"] >= MIN_POINTS) & (stats["sum"] > 0)]

    parts = []
    if len(fit_ids):
        sf = StatsForecast(models=_models(names), freq="D", n_jobs=1)
        out = sf.forecast(h=h, df=df[df["unique_id"].isin(fit_ids)])
        if "unique_id" not in out.columns:
            out = out.reset_index()
        parts.append(out.rename(columns={"unique_id": "product_id", "ds": "date"})[["product_id", "date", *names]])

    rest = panel[~panel["product_id"].isin(fit_ids)]
    if not rest.empty:
        avg = recent_average(rest, h)
        avg = avg.assign(**{n: avg["p50"] for n in names}).drop(columns="p50")
        # recent_average uses rest's own last date; align to the shop's horizon
        dates = _future_dates(panel, h)
        avg["date"] = avg.groupby("product_id").cumcount().map(dict(enumerate(dates)))
        parts.append(avg)

    out = pd.concat(parts, ignore_index=True)
    out[names] = np.clip(out[names].astype(float).to_numpy(), 0, None)
    return out.sort_values(["product_id", "date"]).reset_index(drop=True)
