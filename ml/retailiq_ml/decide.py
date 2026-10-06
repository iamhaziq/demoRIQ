"""Champion model -> daily forecasts -> decisions with reasons (docs/decisions.md, docs/agent.md).
Pure: no Modal or database imports."""

from __future__ import annotations

import math

import pandas as pd

from . import forecast
from .baselines import baseline_forecast, recent_average
from .decisions.reorder import reorder
from .decisions.true_cost import (
    ShopRates,
    financed_share,
    hold_or_clear,
    space_costs,
    storage_cost_annual,
    true_cost,
)
from .panel import LOW_CONFIDENCE_DAYS, history_days
from .quantiles import add_count_quantiles, dispersion, sum_quantiles

H = 28


def forecast_daily(panel: pd.DataFrame, model, holidays: pd.DataFrame, h: int = H) -> pd.DataFrame:
    """model: a forecast.QuantileModel, or a baseline name. Products with under 8 weeks of history
    get the recent average, flagged low confidence. Returns product_id, date, p10, p50, p90, low_confidence."""
    hist = history_days(panel)
    low_ids = set(hist.index[hist < LOW_CONFIDENCE_DAYS])
    ok = panel[~panel["product_id"].isin(low_ids)]
    low = panel[panel["product_id"].isin(low_ids)]
    ratio = dispersion(panel)
    parts = []
    if not ok.empty:
        if isinstance(model, forecast.QuantileModel):
            f = forecast.predict(model, ok, holidays, h)
        else:
            b = baseline_forecast(ok, h, names=[model]).rename(columns={model: "p50"})
            f = add_count_quantiles(b[["product_id", "date", "p50"]], ratio)
        parts.append(f.assign(low_confidence=False))
    if not low.empty:
        parts.append(add_count_quantiles(recent_average(low, h), ratio).assign(low_confidence=True))
    out = pd.concat(parts, ignore_index=True)
    return out[["product_id", "date", "p10", "p50", "p90", "low_confidence"]].sort_values(
        ["product_id", "date"]).reset_index(drop=True)


def _num(v, default=None):
    return default if v is None or (isinstance(v, float) and math.isnan(v)) else v


def build_decisions(settings: dict, products: pd.DataFrame, stock: pd.DataFrame, daily: pd.DataFrame,
                    as_of: str) -> list[dict]:
    """
    settings: data.load_settings(). products: data.ShopData.products. stock: data.latest_stock().
    daily: forecast_daily(). Returns rows for public.decisions: product_id, type, qty, value_rm, reason_json.
    Products need a stock snapshot, a unit cost and a forecast; others are skipped.
    """
    prods = products.set_index("product_id")
    st = stock.set_index("product_id")
    with_cost = [pid for pid in st.index if pid in prods.index and _num(prods.at[pid, "unit_cost"]) is not None]

    shop_value = sum(float(st.at[p, "on_hand"]) * float(prods.at[p, "unit_cost"]) for p in with_cost)
    rates = ShopRates(
        loan_rate=settings["loan_rate_pct"] / 100,
        opportunity_rate=settings["opportunity_rate_pct"] / 100,
        service_rate=settings["service_rate_pct"] / 100,
        financed_share=financed_share(settings["loan_outstanding"], shop_value),
    )
    storage = storage_cost_annual(settings["rent_per_month"], settings["utilities_per_month"],
                                  settings["storage_share_of_rent"])
    space = space_costs(storage, {p: float(st.at[p, "on_hand"]) for p in with_cost},
                        {p: _num(prods.at[p, "shelf_space"], 1.0) for p in with_cost})
    by_product = {pid: g for pid, g in daily.groupby("product_id")}

    rows = []
    for pid in with_cost:
        f = by_product.get(pid)
        if f is None or f.empty:
            continue
        p = prods.loc[pid]
        on_hand, on_order = float(st.at[pid, "on_hand"]), float(_num(st.at[pid, "on_order"], 0.0))
        unit_cost, unit_price = float(p["unit_cost"]), _num(p["unit_price"])
        p50, p90 = f["p50"].tolist(), f["p90"].tolist()
        risk = _num(p["risk_rate_pct"], settings["risk_rate_pct"]) / 100

        tc = true_cost(on_hand, unit_cost, rates, risk, space[pid])
        f10, f50, f90 = sum_quantiles(f["p10"], f["p50"], f["p90"])
        base = {
            "product": {"name": p["name"], "sku": _num(p.get("sku"))},
            "as_of": as_of,
            "forecast": {"days": len(f), "p10": round(f10, 1), "p50": round(f50, 1), "p90": round(f90, 1),
                         "low_confidence": bool(f["low_confidence"].any())},
            "true_cost": tc.reason,
        }

        ro = reorder(on_hand, on_order, p50, p90, int(p["lead_time_days"]), unit_cost,
                     int(_num(p["pack_size"], 1)), settings["review_days"])
        if ro.decision == "REORDER":
            rows.append({
                "product_id": pid, "type": "REORDER", "qty": ro.qty, "value_rm": ro.cash_required,
                "reason_json": {**base, "reorder": {**ro.reason, "qty": ro.qty, "cash_required": ro.cash_required}},
            })

        if unit_price and on_hand > 0:
            days = int(_num(p["holding_days"], settings["holding_days"]))
            mean = sum(p50) / len(p50)
            expected = sum(p50[:days]) + max(days - len(p50), 0) * mean  # beyond 28 days: mean rate
            hc = hold_or_clear(on_hand, float(unit_price), tc.per_unit_per_day, days, expected, rates.loan_rate)
            if hc.reason["share_never_sold"] > 0:
                rows.append({
                    "product_id": pid, "type": hc.decision, "qty": on_hand,
                    "value_rm": hc.cash_released if hc.decision == "CLEAR" else hc.holding_cost_total,
                    "reason_json": {**base, "hold_or_clear": {
                        **hc.reason, "decision": hc.decision, "discount_pct": hc.discount_pct,
                        "cash_released": hc.cash_released, "interest_avoided_per_year": hc.interest_avoided_per_year,
                        "holding_cost_total": hc.holding_cost_total, "clear_at_any_discount": hc.clear_at_any_discount,
                    }},
                })
    return rows
