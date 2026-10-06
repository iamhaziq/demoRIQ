import numpy as np
import pandas as pd
import pytest

from retailiq_ml.panel import build_panel, demand, history_days
from retailiq_ml.quantiles import count_quantiles, sum_quantiles, to_weekly


def test_panel_zero_fills_flags_stockouts_and_prices():
    sales = pd.DataFrame(
        {
            "product_id": ["a", "a", "a", "b"],
            "date": ["2026-10-01", "2026-10-01", "2026-10-03", "2026-10-02"],
            "qty": [2, 1, 4, 5],
            "revenue": [42.0, 21.0, 84.0, None],
        }
    )
    stock = pd.DataFrame({"product_id": ["a"], "date": ["2026-10-02"], "on_hand": [0]})
    products = pd.DataFrame({"product_id": ["a", "b"], "category": ["Minuman", None], "unit_price": [20.0, 3.5]})
    p = build_panel(sales, stock, products, as_of="2026-10-04")

    a = p[p.product_id == "a"].reset_index(drop=True)
    assert a["date"].dt.strftime("%d").tolist() == ["01", "02", "03", "04"]
    assert a["qty"].tolist() == [3.0, 0.0, 4.0, 0.0]  # receipts summed, gaps are 0
    assert a["stockout"].tolist() == [False, True, False, False]
    assert a["price"].tolist() == [21.0, 21.0, 21.0, 21.0]  # revenue/qty, carried forward
    assert demand(a).isna().tolist() == [False, True, False, False]  # stock-out = unknown demand

    b = p[p.product_id == "b"].reset_index(drop=True)
    assert b["date"].min() == pd.Timestamp("2026-10-02")  # starts at first sale
    assert b["price"].tolist() == [3.5, 3.5, 3.5]  # no revenue -> unit_price
    assert b["category"].iloc[0] == "unknown"

    assert history_days(p, pd.Timestamp("2026-10-04")).to_dict() == {"a": 4, "b": 3}


def test_poisson_quantiles_hand_checked():
    # Poisson(10): P(X<=5)=0.067, P(X<=6)=0.130 -> P10 = 6; P(X<=13)=0.864, P(X<=14)=0.917 -> P90 = 14
    assert count_quantiles(np.array([10.0]), np.array([1.0]), 0.1)[0] == 6
    assert count_quantiles(np.array([10.0]), np.array([1.0]), 0.9)[0] == 14
    assert count_quantiles(np.array([0.0]), np.array([3.0]), 0.9)[0] == 0


def test_overdispersed_items_get_wider_ranges():
    p90_pois = count_quantiles(np.array([10.0]), np.array([1.0]), 0.9)[0]
    p90_nb = count_quantiles(np.array([10.0]), np.array([4.0]), 0.9)[0]
    assert p90_nb > p90_pois


def test_sum_quantiles_hand_checked():
    days = pd.Series([10.0] * 7)
    p10, p50, p90 = sum_quantiles(days - 3, days, days + 2)
    assert p50 == 70
    assert p90 == pytest.approx(70 + np.sqrt(7 * 2**2))  # 75.29
    assert p10 == pytest.approx(70 - np.sqrt(7 * 3**2))  # 62.06


def test_to_weekly_blocks_from_forecast_start():
    start = pd.Timestamp("2026-10-07")
    daily = pd.DataFrame(
        {"product_id": "a", "date": pd.date_range(start, periods=14), "p10": 1.0, "p50": 2.0, "p90": 4.0}
    )
    w = to_weekly(daily, start)
    assert w["week_start"].tolist() == [start, start + pd.Timedelta(days=7)]
    assert w["p50"].tolist() == [14.0, 14.0]
