"""Full path: forecasts -> decisions with reasons, checked against the deck and hand calculations."""

import json
import math
from pathlib import Path

import pandas as pd
import pytest

from retailiq_ml.decide import SELL_THROUGH_STEPS, build_decisions, build_metrics, confidence, forecast_daily
from retailiq_ml.panel import build_panel
from retailiq_ml.quantiles import weekly_monday
from retailiq_ml.synthetic import make_holidays, make_shop

DECK = json.loads((Path(__file__).parent / "fixtures" / "deck_examples.json").read_text(encoding="utf-8"))
AS_OF = "2026-10-06"

# The deck's 10 SKUs are 10% of the shop, so shop-level money inputs are scaled by 0.1:
# loan 15,000 -> 1,500 keeps the financed share at 15000/55284.2; rent+utilities 3,450 -> 345.
SETTINGS = {
    "loan_rate_pct": 8.0, "opportunity_rate_pct": 15.0, "service_rate_pct": 3.0, "risk_rate_pct": 12.0,
    "loan_outstanding": 1500.0, "rent_per_month": 300.0, "utilities_per_month": 45.0,
    "storage_share_of_rent": 0.15, "holding_days": 60, "review_days": 7,
}


def deck_inputs():
    prods = pd.DataFrame([{
        "product_id": p["sku"], "name": p["sku"], "sku": p["sku"], "category": p["category_code"],
        "unit_cost": p["cost"], "unit_price": p["price"], "lead_time_days": p["lead_time_days"], "pack_size": 1,
        "shelf_space": 6.0 if p["size"] == "L" else 1.0,
        "risk_rate_pct": 15.0 if p["category_code"] == "HOBBIES" else None,
        "holding_days": 180 if p["category_code"] == "HOBBIES" else None,
    } for p in DECK["products"]])
    stock = pd.DataFrame([{"product_id": p["sku"], "date": AS_OF, "on_hand": float(p["stock"]), "on_order": 0.0}
                          for p in DECK["products"]])
    dates = pd.date_range("2026-10-07", periods=28)
    rows = []
    for p in DECK["products"]:
        f = p["forecast_28d"]
        s = (f["p90"] - f["p50"]) / math.sqrt(28)
        for d in dates:
            rows.append({"product_id": p["sku"], "date": d, "p10": f["p50"] / 28 - s, "p50": f["p50"] / 28,
                         "p90": f["p50"] / 28 + s, "low_confidence": False})
    return prods, stock, pd.DataFrame(rows)


@pytest.fixture(scope="module")
def deck_decisions():
    prods, stock, daily = deck_inputs()
    return {(d["product_id"], d["type"]): d for d in build_decisions(SETTINGS, prods, stock, daily, AS_OF)}


def test_deck_fast_seller_reorder_through_full_path(deck_decisions):
    d = deck_decisions[("FOODS_3_501", "REORDER")]
    assert (d["qty"], d["value_rm"]) == (306, 180.54)
    assert d["reason_json"]["reorder"]["safety_stock"] == pytest.approx(108.05)
    assert ("FOODS_3_501", "CLEAR") not in deck_decisions  # sells out well within 60 days


def test_deck_slow_product_clear_through_full_path(deck_decisions):
    d = deck_decisions[("HOBBIES_1_018", "CLEAR")]
    hc = d["reason_json"]["hold_or_clear"]
    # forecast 4.5 per 28 days -> 28.9 sold in 180 days -> 83.5% never sold; + 1.728 / 11.88 = 14.5%
    assert hc["expected_sold_without_discount"] == 28.9
    assert hc["break_even_discount_pct"] == 98.0
    assert (hc["discount_pct"], d["value_rm"], hc["interest_avoided_per_year"]) == (10, 1496.88, 119.75)
    assert ("HOBBIES_1_018", "REORDER") not in deck_decisions


@pytest.mark.parametrize("p", DECK["products"], ids=lambda p: p["sku"])
def test_true_cost_in_reason_matches_deck(deck_decisions, p):
    d = next(v for (sku, _), v in deck_decisions.items() if sku == p["sku"])
    comps = d["reason_json"]["true_cost"]["components_annual"]
    for part, expected in p["cost_components"].items():
        assert comps[part] == pytest.approx(expected, abs=0.011), part


@pytest.mark.parametrize("p", [p for p in DECK["products"] if p["reorder"]["recommended_qty"]], ids=lambda p: p["sku"])
def test_reorders_match_deck(deck_decisions, p):
    d = deck_decisions[(p["sku"], "REORDER")]
    assert (d["qty"], d["value_rm"]) == (p["reorder"]["recommended_qty"], p["reorder"]["cash_required"])


def test_reason_json_follows_agent_contract(deck_decisions):
    r = deck_decisions[("FOODS_3_501", "REORDER")]["reason_json"]
    assert set(r) == {"product", "as_of", "confidence", "forecast", "true_cost", "reorder"}
    assert {"stock_value", "cost_per_day", "annual_cost"} <= set(r["true_cost"])
    assert {"qty", "cash_required", "days_of_cover", "lead_time_days"} <= set(r["reorder"])
    json.dumps(r)  # storable as jsonb


def test_products_without_stock_cost_or_forecast_are_skipped():
    prods, stock, daily = deck_inputs()
    prods.loc[prods.product_id == "FOODS_3_090", "unit_cost"] = None
    stock = stock[stock.product_id != "FOODS_3_586"]
    daily = daily[daily.product_id != "FOODS_3_252"]
    ids = {d["product_id"] for d in build_decisions(SETTINGS, prods, stock, daily, AS_OF)}
    assert not ids & {"FOODS_3_090", "FOODS_3_586", "FOODS_3_252"}


def test_forecast_daily_flags_short_history_and_supports_baseline_champions():
    sales, stock, products = make_shop(days=120)
    young = pd.DataFrame({"product_id": "baru", "date": pd.date_range(end="2026-09-30", periods=20), "qty": 3.0,
                          "revenue": 9.0})
    panel = build_panel(pd.concat([sales, young]), stock, products)
    daily = forecast_daily(panel, "window_avg_28", make_holidays())
    assert daily.groupby("product_id").size().eq(28).all()
    assert daily.loc[daily.product_id == "baru", "low_confidence"].all()
    assert not daily.loc[daily.product_id == "milo", "low_confidence"].any()
    assert daily.loc[daily.product_id == "baru", "p50"].eq(3.0).all()  # recent average
    assert ((daily.p10 <= daily.p50) & (daily.p50 <= daily.p90)).all()


def test_weekly_monday_keeps_full_weeks_only():
    # Wed 2026-10-07 .. Tue 2026-11-03: full weeks start Mon 10-12, 10-19, 10-26
    daily = pd.DataFrame({"product_id": "a", "date": pd.date_range("2026-10-07", periods=28),
                          "p10": 1.0, "p50": 2.0, "p90": 3.0, "low_confidence": False})
    w = weekly_monday(daily)
    assert w["week_start"].dt.strftime("%m-%d").tolist() == ["10-12", "10-19", "10-26"]
    assert w["p50"].tolist() == [14.0, 14.0, 14.0]
    assert w["p90"].iloc[0] == pytest.approx(14 + math.sqrt(7))


def test_slider_rows_match_deck_sensitivity_table(deck_decisions):
    rows = deck_decisions[("HOBBIES_1_018", "CLEAR")]["reason_json"]["hold_or_clear"]["by_sell_through"]
    assert [r["sell_through"] for r in rows] == SELL_THROUGH_STEPS
    deck = {r["sell_through"]: r for r in next(p for p in DECK["products"]
                                               if p["sku"] == "HOBBIES_1_018")["hold_or_clear"]["by_sell_through"]}
    for r in rows:
        if r["sell_through"] in deck:
            d = deck[r["sell_through"]]
            assert (r["break_even_discount_pct"], r["cash_released"], r["interest_avoided_per_year"]) == (
                d["break_even_discount_pct"], d["cash_released"], d["interest_avoided_per_year"])


def test_confidence_labels():
    assert confidence(True, 0.10) == "Low"
    assert confidence(False, None) == "Low"
    assert confidence(False, 0.20) == "High"
    assert confidence(False, 0.30) == "Medium"
    assert confidence(False, 0.45) == "Low"


def test_metrics_for_every_product_match_deck():
    prods, stock, daily = deck_inputs()
    stock["received_date"] = pd.Timestamp("2026-09-20")
    m = {r["product_id"]: r for r in build_metrics(SETTINGS, prods, stock, daily, AS_OF)}
    assert set(m) == {p["sku"] for p in DECK["products"]}  # all products, not only those with a decision
    for p in DECK["products"]:
        r = m[p["sku"]]
        assert r["stock_value"] == pytest.approx(p["inventory_value"])
        assert r["cost_per_day"] == pytest.approx(p["cost_per_day"])
        assert r["cost_30d"] == pytest.approx(p["cost_30d"], abs=0.011)
        assert r["cost_180d"] == pytest.approx(p["cost_180d"], abs=0.011)
        assert r["annual_cost"] == pytest.approx(p["carrying_cost_annual"], abs=0.011)
    assert m["FOODS_3_501"]["days_of_cover"] == pytest.approx(4.45)
    assert m["HOBBIES_1_018"]["slow_stock"] and not m["FOODS_3_501"]["slow_stock"]
    assert m["FOODS_3_501"]["age_days"] == 16  # 2026-09-20 -> 2026-10-06
    assert m["FOODS_3_501"]["forecast_p50"] == 579.0
    assert m["FOODS_3_501"]["confidence"] == "Low"  # no champion WAPE given


def test_metrics_confidence_uses_champion_wape():
    # Same rule as the cards: WAPE 0.20 < 0.25 -> High; 0.30 -> Medium; short history always Low.
    prods, stock, daily = deck_inputs()
    for wape, label in [(0.20, "High"), (0.30, "Medium")]:
        m = {r["product_id"]: r for r in build_metrics(SETTINGS, prods, stock, daily, AS_OF, model_wape=wape)}
        assert m["FOODS_3_501"]["confidence"] == label
    daily.loc[daily.product_id == "FOODS_3_501", "low_confidence"] = True
    m = {r["product_id"]: r for r in build_metrics(SETTINGS, prods, stock, daily, AS_OF, model_wape=0.20)}
    assert m["FOODS_3_501"]["confidence"] == "Low"
