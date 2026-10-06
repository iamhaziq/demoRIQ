"""Quantile helpers: daily P10/P90 for point forecasts, and daily -> weekly/lead-time sums."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from .panel import demand


def dispersion(panel: pd.DataFrame, days: int = 90) -> pd.Series:
    """variance / mean of daily demand per product over the last `days` (1.0 = Poisson)."""
    recent = panel[panel["date"] > panel["date"].max() - pd.Timedelta(days=days)].copy()
    recent["y"] = demand(recent)
    g = recent.groupby("product_id")["y"]
    mean, var = g.mean(), g.var()
    ratio = (var / mean).where(mean > 0)
    return ratio.fillna(1.0).clip(lower=1.0)


def count_quantiles(mean: np.ndarray, ratio: np.ndarray, q: float) -> np.ndarray:
    """
    Quantile q of a count distribution with the given mean and variance/mean ratio:
    Poisson when ratio <= 1, else negative binomial with n = mean / (ratio - 1), p = 1 / ratio.
    """
    mean = np.clip(np.asarray(mean, dtype=float), 0, None)
    ratio = np.clip(np.asarray(ratio, dtype=float), 1.0, None)
    out = np.zeros_like(mean)
    pos = mean > 0
    pois = pos & (ratio <= 1.0 + 1e-9)
    nb = pos & ~pois
    out[pois] = stats.poisson.ppf(q, mean[pois])
    out[nb] = stats.nbinom.ppf(q, mean[nb] / (ratio[nb] - 1.0), 1.0 / ratio[nb])
    return out


def add_count_quantiles(daily: pd.DataFrame, ratio: pd.Series) -> pd.DataFrame:
    """daily: product_id, date, p50 -> adds p10 and p90 from the product's dispersion."""
    r = daily["product_id"].map(ratio).fillna(1.0).to_numpy()
    out = daily.copy()
    out["p10"] = np.minimum(count_quantiles(out["p50"].to_numpy(), r, 0.1), out["p50"])
    out["p90"] = np.maximum(count_quantiles(out["p50"].to_numpy(), r, 0.9), out["p50"])
    return out


def sum_quantiles(p10: pd.Series, p50: pd.Series, p90: pd.Series) -> tuple[float, float, float]:
    """
    Quantiles of a sum of days. P50 adds; spreads add in quadrature (days treated as independent).
    7 days of P50 = 10, P90 = 12  ->  P50 = 70, P90 = 70 + sqrt(7 * 2^2) = 75.29.
    """
    s50 = float(p50.sum())
    up = float(np.sqrt(((p90 - p50) ** 2).sum()))
    down = float(np.sqrt(((p50 - p10) ** 2).sum()))
    return max(s50 - down, 0.0), s50, s50 + up


def to_weekly(daily: pd.DataFrame, start: pd.Timestamp) -> pd.DataFrame:
    """daily: product_id, date, p10, p50, p90 -> product_id, week_start, p10, p50, p90.
    Weeks are 7-day blocks counted from `start` (the first forecast day)."""
    d = daily.copy()
    d["week_start"] = pd.Timestamp(start) + pd.to_timedelta(((d["date"] - pd.Timestamp(start)).dt.days // 7) * 7, unit="D")
    rows = []
    for (pid, wk), g in d.groupby(["product_id", "week_start"], sort=True):
        p10, p50, p90 = sum_quantiles(g["p10"], g["p50"], g["p90"])
        rows.append({"product_id": pid, "week_start": wk, "p10": p10, "p50": p50, "p90": p90})
    return pd.DataFrame(rows, columns=["product_id", "week_start", "p10", "p50", "p90"])


def weekly_monday(daily: pd.DataFrame) -> pd.DataFrame:
    """daily: product_id, date, p10, p50, p90[, low_confidence] -> calendar weeks starting Monday.
    Only weeks with all 7 days forecast are kept (a partial week would understate demand)."""
    d = daily.copy()
    d["week_start"] = d["date"] - pd.to_timedelta(d["date"].dt.dayofweek, unit="D")
    rows = []
    for (pid, wk), g in d.groupby(["product_id", "week_start"], sort=True):
        if len(g) < 7:
            continue
        p10, p50, p90 = sum_quantiles(g["p10"], g["p50"], g["p90"])
        rows.append({"product_id": pid, "week_start": wk, "p10": p10, "p50": p50, "p90": p90,
                     "low_confidence": bool(g.get("low_confidence", pd.Series([False])).any())})
    return pd.DataFrame(rows, columns=["product_id", "week_start", "p10", "p50", "p90", "low_confidence"])
