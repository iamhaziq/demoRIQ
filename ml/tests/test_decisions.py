"""Decision rules reproduce the pitch deck exactly (fixture copied from the prototype)."""

import json
import math
from pathlib import Path

import pytest

from retailiq_ml.decisions.reorder import reorder
from retailiq_ml.decisions.true_cost import (
    ShopRates,
    financed_share,
    hold_or_clear,
    space_costs,
    storage_cost_annual,
    true_cost,
)

DECK = json.loads((Path(__file__).parent / "fixtures" / "deck_examples.json").read_text(encoding="utf-8"))
B = DECK["business"]
PRODUCTS = {p["sku"]: p for p in DECK["products"]}
SIZE_SPACE = {"S": 1.0, "L": 6.0}  # shelf space per unit used by the prototype
RISK = {"FOODS": 0.12, "HOBBIES": 0.15}


def deck_rates() -> ShopRates:
    # The deck's SKUs are 10% of the shop's stock: shop value = demo value / 0.1.
    shop_value = sum(p["inventory_value"] for p in PRODUCTS.values()) / B["demo_sku_share_of_shop"]
    return ShopRates(B["financing_rate"], B["opportunity_rate"], B["service_rate"],
                     financed_share(B["financing_amount"], shop_value))


def deck_space() -> dict[str, float]:
    storage = storage_cost_annual(B["monthly_rent"], B["monthly_utilities"], B["storage_share_of_rent"])
    storage *= B["demo_sku_share_of_shop"]
    return space_costs(storage, {k: p["stock"] for k, p in PRODUCTS.items()},
                       {k: SIZE_SPACE[p["size"]] for k, p in PRODUCTS.items()})


def deck_cost(sku):
    p = PRODUCTS[sku]
    return true_cost(p["stock"], p["cost"], deck_rates(), RISK[p["category_code"]], deck_space()[sku])


def flat_forecast(p, days=28):
    """Daily forecast matching the deck's 28-day P50/P90: flat P50, spread adding in quadrature."""
    f = p["forecast_28d"]
    s = (f["p90"] - f["p50"]) / math.sqrt(days)
    return [f["p50"] / days] * days, [f["p50"] / days + s] * days


# ---- the two worked examples from the deck ------------------------------------------------

def test_deck_slow_product_175_units_10_percent_clearance():
    p = PRODUCTS["HOBBIES_1_018"]
    cost = deck_cost("HOBBIES_1_018")
    r = hold_or_clear(units=175, unit_price=11.88, cost_per_unit_per_day=cost.per_unit_per_day,
                      holding_days=180, expected_sold=0.8 * 175, loan_rate=0.08)
    assert cost.per_unit_per_day == 0.0096
    assert r.decision == "CLEAR"
    assert r.discount_pct == 10
    assert r.holding_cost_per_unit == 1.73
    assert r.holding_cost_total == 302.40
    assert r.break_even_discount_pct == 34.5
    assert r.cash_released == 1496.88
    assert r.interest_avoided_per_year == 119.75
    assert p["hold_or_clear"]["cash_released"] == 1496.88  # fixture agrees with the deck card


def test_deck_fast_seller_579_forecast_4_days_stock_7_day_lead():
    p50, p90 = flat_forecast(PRODUCTS["FOODS_3_501"])
    r = reorder(on_hand=92, on_order=0, daily_p50=p50, daily_p90=p90, lead_time_days=7, unit_cost=0.59)
    assert sum(p50) == pytest.approx(579.0)
    assert r.decision == "REORDER"
    assert r.qty == 306
    assert r.cash_required == 180.54
    assert r.reason["demand_over_lead_and_review"] == 289.5  # 14 of 28 days
    assert r.reason["safety_stock"] == pytest.approx(108.05)  # (795.1 - 579) x sqrt(7/28)
    assert r.days_of_cover == pytest.approx(4.45)  # forecast-based; the deck's 4.0 used recent sales


# ---- every prototype product ---------------------------------------------------------------

@pytest.mark.parametrize("sku", sorted(PRODUCTS))
def test_true_cost_matches_prototype(sku):
    p, c = PRODUCTS[sku], deck_cost(sku)
    assert c.value == pytest.approx(p["inventory_value"])
    for part, expected in p["cost_components"].items():
        assert c.components[part] == pytest.approx(expected, abs=0.011), part
    assert c.annual == pytest.approx(p["carrying_cost_annual"], abs=0.011)
    assert c.per_day == pytest.approx(p["cost_per_day"])
    assert c.per_unit_per_day == p["cost_per_unit_per_day"]


@pytest.mark.parametrize("sku", sorted(PRODUCTS))
def test_hold_or_clear_matches_prototype(sku):
    p, c = PRODUCTS[sku], deck_cost(sku)
    h = p["hold_or_clear"]
    for row in [h, *h["by_sell_through"]]:
        r = hold_or_clear(p["stock"], p["price"], c.per_unit_per_day, h["holding_days"],
                          expected_sold=row["sell_through"] * p["stock"], loan_rate=B["financing_rate"],
                          clearance_sell_through=row["sell_through"])
        assert r.break_even_discount_pct == row["break_even_discount_pct"]
        assert r.cash_released == row["cash_released"]
        assert r.interest_avoided_per_year == row["interest_avoided_per_year"]
    r = hold_or_clear(p["stock"], p["price"], c.per_unit_per_day, h["holding_days"],
                      expected_sold=h["sell_through"] * p["stock"], loan_rate=B["financing_rate"])
    assert r.holding_cost_total == h["holding_cost_total"]
    assert r.holding_cost_per_unit == h["holding_cost_per_unit"]
    assert r.discount_pct == h["start_discount_pct"]
    assert r.clear_at_any_discount == h["clear_at_any_discount"]


@pytest.mark.parametrize("sku", sorted(PRODUCTS))
def test_reorder_matches_prototype(sku):
    p = PRODUCTS[sku]
    p50, p90 = flat_forecast(p)
    r = reorder(p["stock"], 0, p50, p90, p["lead_time_days"], p["cost"])
    assert r.qty == p["reorder"]["recommended_qty"]
    assert r.cash_required == p["reorder"]["cash_required"]


# ---- hand-checked edge cases ----------------------------------------------------------------

def test_clear_at_any_discount_when_holding_costs_more_than_the_price():
    # 10 units at RM2, holding costs RM0.02/day x 120 days = RM2.40/unit > price
    r = hold_or_clear(10, 2.0, 0.02, 120, expected_sold=0, loan_rate=0.08)
    assert r.clear_at_any_discount and r.decision == "CLEAR" and r.discount_pct == 10
    assert r.break_even_discount_pct == 220.0  # 100% never sold + 120%


def test_hold_when_forecast_sells_everything_in_the_window():
    r = hold_or_clear(50, 4.0, 0.001, 60, expected_sold=80, loan_rate=0.08)
    assert r.decision == "HOLD" and r.reason["share_never_sold"] == 0


def test_hold_when_no_discount_step_pays():
    # 5% never sold + RM0.10 / RM10 = 6% break-even: even 10% off costs more than waiting
    r = hold_or_clear(100, 10.0, 0.001, 100, expected_sold=95, loan_rate=0.08)
    assert r.break_even_discount_pct == 6.0
    assert r.decision == "HOLD" and r.discount_pct is None


def test_reorder_rounds_up_to_pack_and_counts_stock_on_order():
    # 10/day flat, no spread, lead 3 + review 7 = 100 units needed; 20 on hand, 30 on order -> 50 -> 2 packs of 24
    r = reorder(on_hand=20, on_order=30, daily_p50=[10.0] * 28, daily_p90=[10.0] * 28,
                lead_time_days=3, unit_cost=1.5, pack_size=24)
    assert r.reason["units_needed"] == 50
    assert r.qty == 72 and r.cash_required == 108.0


def test_no_reorder_with_enough_cover_or_no_demand():
    assert reorder(500, 0, [10.0] * 28, [12.0] * 28, 7, 1.0).decision == "HOLD"  # 50 days of cover
    r = reorder(5, 0, [0.0] * 28, [0.0] * 28, 7, 1.0)
    assert r.decision == "HOLD" and r.days_of_cover is None


def test_financed_share_and_space_split():
    assert financed_share(15000, 55284.2) == pytest.approx(0.27133, abs=1e-5)
    assert financed_share(100000, 50000) == 1.0  # loan larger than stock: all of it is financed
    assert financed_share(0, 50000) == 0.0
    assert space_costs(600.0, {"a": 10, "b": 10}, {"a": 1, "b": 2}) == {"a": 200.0, "b": 400.0}
