import numpy as np
import pandas as pd
import pytest

from retailiq_ml import forecast
from retailiq_ml.baselines import BASELINES, baseline_forecast, filled_demand, recent_average
from retailiq_ml.evaluate import backtest, cutoffs, wape
from retailiq_ml.features import FEATURES, days_until, make_features
from retailiq_ml.panel import build_panel
from retailiq_ml.registry import LGBM, choose_candidate, should_promote
from retailiq_ml.synthetic import make_holidays, make_shop


@pytest.fixture(scope="module")
def shop():
    sales, stock, products = make_shop(days=180)
    return build_panel(sales, stock, products), make_holidays()


def weekly_panel(weeks=10):
    """One product selling exactly [1..7] Mon..Sun every week; no stock-outs."""
    dates = pd.date_range("2026-06-01", periods=weeks * 7, freq="D")  # 2026-06-01 is a Monday
    return pd.DataFrame(
        {"product_id": "a", "date": dates, "qty": (dates.dayofweek + 1).astype(float),
         "price": 1.0, "stockout": False, "category": "x"}
    )


# ---- features -------------------------------------------------------------------------------

def test_days_until_hand_checked():
    d = pd.Series(pd.to_datetime(["2026-03-01", "2026-03-21", "2026-03-22", "2026-12-01"]))
    raya = pd.Series(pd.to_datetime(["2026-03-21", "2027-03-10"]))
    assert days_until(d, raya).tolist() == [20, 0, 60, 60]  # 3/22 -> next is 2027 (>60, capped)


def test_features_use_only_data_28_days_old():
    p = weekly_panel(10)
    p["y"] = p["qty"]
    X = make_features(p, make_holidays())
    assert list(X.columns) == ["product_id", "date", "y", *FEATURES]
    row = X[X["date"] == pd.Timestamp("2026-07-27")].iloc[0]  # Monday, day 57
    assert row["lag_28"] == 1 and row["lag_49"] == 1  # same weekday 4 and 7 weeks back
    assert row["dow_mean_4w"] == 1
    assert row["roll_mean_7"] == pytest.approx(4.0)  # mean of 1..7, the week ending 28 days back
    assert row["payday"] == 1  # 25th..1st
    assert row["days_to_holiday"] == 35  # National Day, 31 Aug
    early = X[X["date"] == pd.Timestamp("2026-06-28")].iloc[0]  # day 28: nothing 28 days old yet
    assert np.isnan(early["lag_28"]) and np.isnan(early["roll_mean_7"])


# ---- baselines ------------------------------------------------------------------------------

def test_seasonal_naive_and_window_average_hand_checked():
    p = weekly_panel(10)
    fc = baseline_forecast(p, h=7)
    assert fc["seasonal_naive"].tolist() == pytest.approx([1, 2, 3, 4, 5, 6, 7])
    assert fc["window_avg_28"].tolist() == pytest.approx([4.0] * 7)  # mean of last 28 days
    assert set(BASELINES) <= set(fc.columns)
    assert (fc[list(BASELINES)] >= 0).all().all()


def test_stockout_days_filled_before_baselines():
    p = weekly_panel(5)
    p.loc[p.index[-1], "stockout"] = True
    p.loc[p.index[-1], "qty"] = 0.0
    filled = filled_demand(p)
    assert filled.iloc[-1] > 0  # recent median, not a fake zero


def test_short_history_uses_recent_average():
    p = weekly_panel(1)  # 7 days only
    fc = baseline_forecast(p, h=3)
    assert fc["seasonal_naive"].tolist() == pytest.approx([4.0] * 3)
    assert recent_average(p, 3)["p50"].tolist() == pytest.approx([4.0] * 3)


# ---- LightGBM -------------------------------------------------------------------------------

def test_lightgbm_forecast_shape_and_quantiles(shop):
    panel, hol = shop
    model = forecast.fit(panel, hol)
    fc = forecast.predict(model, panel, hol, h=28)
    assert len(fc) == 28 * panel["product_id"].nunique()
    assert (fc["p10"] <= fc["p50"]).all() and (fc["p50"] <= fc["p90"]).all()
    assert (fc["p10"] >= 0).all()
    assert fc["date"].min() == panel["date"].max() + pd.Timedelta(days=1)


def test_lightgbm_is_deterministic(shop):
    panel, hol = shop
    a = forecast.predict(forecast.fit(panel, hol), panel, hol, h=7)
    b = forecast.predict(forecast.fit(panel, hol), panel, hol, h=7)
    pd.testing.assert_frame_equal(a, b)


# ---- evaluation -----------------------------------------------------------------------------

def test_wape_hand_checked():
    # |8-10| + |5-5| + |0-5| = 7 over 20 sold
    assert wape([10, 5, 5], [8, 5, 0]) == pytest.approx(0.35)
    assert wape([0, 0], [1, 1]) is None


def test_cutoffs():
    c = cutoffs(pd.Timestamp("2026-09-30"))
    assert c == [pd.Timestamp(d) for d in ("2026-08-12", "2026-08-19", "2026-08-26", "2026-09-02")]


def test_backtest_oracle_and_zero(shop):
    panel, _ = shop

    def predict_fn(train, h):
        cut = train["date"].max()
        future = panel[(panel["date"] > cut) & (panel["date"] <= cut + pd.Timedelta(days=h))
                       & panel["product_id"].isin(train["product_id"].unique())]
        return future[["product_id", "date"]].assign(oracle=future["qty"].to_numpy(), zero=0.0)

    res = backtest(panel, predict_fn)
    assert res.windows == 4
    assert res.scores["oracle"] == pytest.approx(0.0)
    assert res.scores["zero"] == pytest.approx(1.0)


def test_backtest_skips_short_history():
    res = backtest(weekly_panel(6), lambda t, h: pd.DataFrame(columns=["product_id", "date", "m"]))
    assert res.windows == 0 and res.scores == {}


def payday_shop(days=200, n=20):
    """No noise: demand doubles from the 25th to the 1st. A 28-day average cannot see this coming."""
    dates = pd.date_range(end="2026-09-30", periods=days, freq="D")
    pay = ((dates.day >= 25) | (dates.day == 1)).astype(float)
    rows = [
        {"product_id": f"p{i}", "date": d, "price": 1.0, "stockout": False, "category": "x",
         "qty": float(2 + i) * (1 + q)}
        for i in range(n) for d, q in zip(dates, pay)
    ]
    return pd.DataFrame(rows)


def test_lightgbm_learns_payday_pattern_baseline_cannot():
    panel, hol = payday_shop(), make_holidays()

    def predict_fn(train, h):
        base = baseline_forecast(train, h, names=["window_avg_28"])
        lg = forecast.predict(forecast.fit(train, hol), train, hol, h)[["product_id", "date", "p50"]]
        return base.merge(lg.rename(columns={"p50": LGBM}), on=["product_id", "date"])

    res = backtest(panel, predict_fn, n_windows=2)
    assert res.scores[LGBM] < 0.5 * res.scores["window_avg_28"]


# ---- registry rules -------------------------------------------------------------------------

def test_choose_candidate_requires_5_percent_win():
    assert choose_candidate({LGBM: 0.30, "seasonal_naive": 0.40, "auto_ets": 0.35}) == (LGBM, 0.30, 0.35)
    # 0.34 > 0.95 * 0.35 = 0.3325 -> not enough, best baseline wins
    assert choose_candidate({LGBM: 0.34, "auto_ets": 0.35}) == ("auto_ets", 0.35, 0.35)
    assert choose_candidate({LGBM: 0.3325, "auto_ets": 0.35})[0] == LGBM  # exactly 5% better
    assert choose_candidate({LGBM: None, "auto_ets": 0.35})[0] == "auto_ets"
    assert choose_candidate({}) == ("window_avg_28", None, None)


def test_should_promote():
    assert should_promote(0.4, None)
    assert should_promote(0.19, {"wape": 0.20})  # 0.19 = 0.95 * 0.20
    assert not should_promote(0.195, {"wape": 0.20})
    assert not should_promote(None, {"wape": 0.20})
    assert should_promote(0.3, {"wape": None})


def test_synthetic_shop_is_deterministic():
    a, _, _ = make_shop(days=30, seed=1)
    b, _, _ = make_shop(days=30, seed=1)
    pd.testing.assert_frame_equal(a, b)
    assert np.isclose(a["revenue"].sum(), b["revenue"].sum())
