"""Features for the LightGBM model: one row per product per day (docs/forecast.md).

Direct forecasting: every demand-history feature uses data at least ORIGIN days old, so all 28
forecast days are predicted in one pass from known data. (Recursive forecasting with lags 7/14,
feeding predictions back in, scored worse in backtests.)
"""

from __future__ import annotations

import numpy as np
import pandas as pd

ORIGIN = 28  # = forecast horizon; history features never look closer than this
LAGS = (28, 35, 42, 49)  # same weekday, 4..7 weeks back
WINDOWS = (7, 28, 56)  # rolling means ending ORIGIN days back
DAYS_CAP = 60
HISTORY_NEEDED = ORIGIN + max(max(LAGS), max(WINDOWS)) + 7  # days of history used when predicting

EVENTS = {
    "days_to_raya": "Aidilfitri",
    "days_to_cny": "Chinese New Year",
    "days_to_deepavali": "Deepavali",
}

FEATURES = [
    *[f"lag_{n}" for n in LAGS],
    "dow_mean_4w",
    *[f"roll_mean_{w}" for w in WINDOWS],
    "roll_std_28",
    "dow",
    "month",
    "dom",
    "payday",
    "is_holiday",
    *EVENTS,
    "days_to_holiday",
    "price",
    "price_rel",
    "category",
]


def days_until(dates: pd.Series, events: pd.Series, cap: int = DAYS_CAP) -> np.ndarray:
    """Days from each date to the next event on or after it, capped (cap also when none ahead)."""
    ev = np.sort(pd.to_datetime(events).to_numpy(dtype="datetime64[D]"))
    d = pd.to_datetime(dates).to_numpy(dtype="datetime64[D]")
    if len(ev) == 0:
        return np.full(len(d), cap, dtype=float)
    idx = np.searchsorted(ev, d, side="left")
    nxt = ev[np.minimum(idx, len(ev) - 1)]
    days = (nxt - d).astype(float)
    days[idx >= len(ev)] = cap
    return np.minimum(days, cap)


def make_features(
    df: pd.DataFrame,
    holidays: pd.DataFrame,
    price_median: pd.Series | None = None,
    categories: list[str] | None = None,
) -> pd.DataFrame:
    """
    df: product_id, date, y (demand; NaN = unknown/stock-out/future), price, category.
    One row per product per consecutive day. Returns product_id, date, y and FEATURES.
    """
    df = df.sort_values(["product_id", "date"])
    out = df[["product_id", "date", "y"]].copy()
    g = df.groupby("product_id")["y"]
    for n in LAGS:
        out[f"lag_{n}"] = g.shift(n)
    out["dow_mean_4w"] = out[[f"lag_{n}" for n in LAGS]].mean(axis=1)
    base = g.shift(ORIGIN)
    for w in WINDOWS:
        roll = base.groupby(df["product_id"]).rolling(w, min_periods=1)
        out[f"roll_mean_{w}"] = roll.mean().reset_index(level=0, drop=True)
    out["roll_std_28"] = (
        base.groupby(df["product_id"]).rolling(28, min_periods=2).std().reset_index(level=0, drop=True)
    )

    date = df["date"]
    out["dow"] = date.dt.dayofweek
    out["month"] = date.dt.month
    out["dom"] = date.dt.day
    out["payday"] = ((date.dt.day >= 25) | (date.dt.day == 1)).astype(int)

    hol = holidays if holidays is not None else pd.DataFrame(columns=["date", "name"])
    hol_dates = pd.to_datetime(hol["date"])
    out["is_holiday"] = date.isin(set(hol_dates)).astype(int)
    for col, pattern in EVENTS.items():
        out[col] = days_until(date, hol_dates[hol["name"].str.contains(pattern, case=False, na=False)])
    out["days_to_holiday"] = days_until(date, hol_dates)

    out["price"] = df["price"].astype(float)
    pm = price_median if price_median is not None else df.groupby("product_id")["price"].median()
    out["price_rel"] = out["price"] / df["product_id"].map(pm)
    cats = categories if categories is not None else sorted(df["category"].astype(str).unique())
    out["category"] = pd.Categorical(df["category"].astype(str), categories=cats)
    return out
