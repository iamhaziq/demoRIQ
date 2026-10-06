"""LightGBM models: one set per shop across its products.

P50 is the expected daily demand (Poisson objective), not the daily median: for skewed counts the
median sits below the mean, so summing daily medians under-forecasts weeks. P10/P90 come from
quantile models (alpha 0.1, 0.9). Forecasts are direct (see features.py), no recursion.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import lightgbm as lgb
import numpy as np
import pandas as pd

from .features import FEATURES, HISTORY_NEEDED, ORIGIN, make_features
from .panel import demand

QUANTILES = (0.1, 0.5, 0.9)  # 0.5 is served by the mean (Poisson) model
OBJECTIVES = {
    0.1: dict(objective="quantile", alpha=0.1),
    0.5: dict(objective="poisson"),
    0.9: dict(objective="quantile", alpha=0.9),
}
PARAMS = dict(
    n_estimators=300,
    learning_rate=0.05,
    num_leaves=31,
    min_child_samples=20,
    subsample=0.8,
    subsample_freq=1,
    colsample_bytree=0.8,
    random_state=42,
    n_jobs=1,
    deterministic=True,
    verbose=-1,
)


@dataclass
class QuantileModel:
    models: dict[float, lgb.LGBMRegressor]
    categories: list[str]
    price_median: pd.Series
    features: list[str] = field(default_factory=lambda: list(FEATURES))


def _frame(panel: pd.DataFrame) -> pd.DataFrame:
    df = panel[["product_id", "date", "price", "category"]].copy()
    df["y"] = demand(panel)
    return df


def training_rows(panel: pd.DataFrame, holidays: pd.DataFrame, price_median=None, categories=None) -> pd.DataFrame:
    X = make_features(_frame(panel), holidays, price_median, categories)
    return X[X["y"].notna() & X["roll_mean_7"].notna()]  # needs > ORIGIN days of history


def fit(panel: pd.DataFrame, holidays: pd.DataFrame, params: dict | None = None) -> QuantileModel:
    categories = sorted(panel["category"].astype(str).unique())
    price_median = panel.groupby("product_id")["price"].median()
    train = training_rows(panel, holidays, price_median, categories)
    if train.empty:
        raise ValueError(f"not enough history to train LightGBM (need more than {ORIGIN} days)")
    models = {}
    for q in QUANTILES:
        m = lgb.LGBMRegressor(**OBJECTIVES[q], **{**PARAMS, **(params or {})})
        m.fit(train[FEATURES], train["y"])
        models[q] = m
    return QuantileModel(models, categories, price_median)


def predict(model: QuantileModel, panel: pd.DataFrame, holidays: pd.DataFrame, h: int = ORIGIN) -> pd.DataFrame:
    """Forecast h <= ORIGIN days after the panel's last date in one pass.
    Returns product_id, date, p10, p50, p90 with 0 <= p10 <= p50 <= p90."""
    if h > ORIGIN:
        raise ValueError(f"direct features support horizons up to {ORIGIN} days")
    as_of = panel["date"].max()
    hist = _frame(panel[panel["date"] > as_of - pd.Timedelta(days=HISTORY_NEEDED)])
    last = hist.sort_values("date").groupby("product_id").tail(1).set_index("product_id")

    dates = pd.date_range(as_of + pd.Timedelta(days=1), periods=h, freq="D")
    future = pd.DataFrame([(pid, d) for pid in last.index for d in dates], columns=["product_id", "date"])
    future["price"] = future["product_id"].map(last["price"])
    future["category"] = future["product_id"].map(last["category"])
    future["y"] = np.nan

    X = make_features(pd.concat([hist, future], ignore_index=True), holidays, model.price_median, model.categories)
    X = X[X["date"] > as_of]
    preds = np.clip(np.column_stack([model.models[q].predict(X[model.features]) for q in QUANTILES]), 0, None)
    preds[:, 0] = np.minimum(preds[:, 0], preds[:, 1])
    preds[:, 2] = np.maximum(preds[:, 2], preds[:, 1])
    out = X[["product_id", "date"]].assign(p10=preds[:, 0], p50=preds[:, 1], p90=preds[:, 2])
    return out.sort_values(["product_id", "date"]).reset_index(drop=True)
