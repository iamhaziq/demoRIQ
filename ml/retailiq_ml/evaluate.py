"""Rolling-origin backtest scored with WAPE (docs/forecast.md)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import pandas as pd

from .panel import LOW_CONFIDENCE_DAYS, history_days

H = 28
N_WINDOWS = 4
STEP = 7

# predict_fn(train_panel, h) -> product_id, date, <one column per model>
PredictFn = Callable[[pd.DataFrame, int], pd.DataFrame]


@dataclass
class BacktestResult:
    scores: dict[str, float | None]
    windows: int
    products: int


def cutoffs(as_of: pd.Timestamp, n_windows: int = N_WINDOWS, step: int = STEP, h: int = H) -> list[pd.Timestamp]:
    """Last training day of each window, oldest first; the last window ends exactly at as_of."""
    last = pd.Timestamp(as_of) - pd.Timedelta(days=h)
    return [last - pd.Timedelta(days=step * (n_windows - 1 - i)) for i in range(n_windows)]


def wape(actual, forecast) -> float | None:
    """sum |forecast - actual| / sum actual. None when there were no sales to score against."""
    actual = pd.Series(actual, dtype=float)
    total = actual.sum()
    if total <= 0:
        return None
    return float((pd.Series(forecast, dtype=float).to_numpy() - actual.to_numpy()).__abs__().sum() / total)


def backtest(
    panel: pd.DataFrame,
    predict_fn: PredictFn,
    h: int = H,
    n_windows: int = N_WINDOWS,
    step: int = STEP,
    min_history: int = LOW_CONFIDENCE_DAYS,
) -> BacktestResult:
    """Score every model column from predict_fn on product-week sums over non-stock-out days.
    Only products with min_history days at the cutoff are scored."""
    as_of = panel["date"].max()
    frames, products, windows = [], set(), 0
    for i, cut in enumerate(cutoffs(as_of, n_windows, step, h)):
        train = panel[panel["date"] <= cut]
        if train.empty:
            continue
        hist = history_days(train, cut)
        eligible = hist.index[hist >= min_history]
        if len(eligible) == 0:
            continue
        fc = predict_fn(train[train["product_id"].isin(eligible)], h)
        actual = panel[
            (panel["date"] > cut) & (panel["date"] <= cut + pd.Timedelta(days=h)) & panel["product_id"].isin(eligible)
        ]
        m = actual.merge(fc, on=["product_id", "date"], how="left")
        m = m[~m["stockout"]].copy()
        m["window"] = i
        m["week"] = (m["date"] - cut - pd.Timedelta(days=1)).dt.days // 7
        frames.append(m)
        products.update(eligible)
        windows += 1

    if not frames:
        return BacktestResult({}, 0, 0)
    allm = pd.concat(frames, ignore_index=True)
    models = [c for c in allm.columns if c not in {"product_id", "date", "qty", "price", "stockout", "category", "window", "week"}]
    weekly = allm.groupby(["window", "product_id", "week"])[["qty", *models]].sum(min_count=1)
    scores = {}
    for name in models:
        ok = weekly[name].notna()
        scores[name] = wape(weekly.loc[ok, "qty"], weekly.loc[ok, name]) if ok.all() else None
    return BacktestResult(scores, windows, len(products))
