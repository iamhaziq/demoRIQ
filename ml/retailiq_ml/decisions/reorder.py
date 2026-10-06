"""Reorder rule: forecast + lead time + safety stock (docs/decisions.md). Pure functions."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

REVIEW_DAYS = 7


@dataclass
class Reorder:
    decision: str  # "REORDER" or "HOLD"
    qty: int
    cash_required: float
    days_of_cover: float | None  # None = no forecast demand
    reason: dict


def _days(values: Sequence[float], n: int, fill: float) -> list[float]:
    """First n daily values, extended with `fill` if the forecast is shorter."""
    v = list(values[:n])
    return v + [fill] * (n - len(v))


def reorder(
    on_hand: float,
    on_order: float,
    daily_p50: Sequence[float],
    daily_p90: Sequence[float],
    lead_time_days: int,
    unit_cost: float,
    pack_size: int = 1,
    review_days: int = REVIEW_DAYS,
) -> Reorder:
    daily = sum(daily_p50) / len(daily_p50) if daily_p50 else 0.0
    cover = on_hand / daily if daily > 0 else None
    cycle = lead_time_days + review_days
    trigger = cover is not None and cover < cycle

    p50 = _days(daily_p50, cycle, daily)
    spread = [hi - lo for hi, lo in zip(_days(daily_p90, lead_time_days, 0.0), p50[:lead_time_days])]
    demand = sum(p50)
    safety = math.sqrt(sum(s * s for s in spread))  # days added in quadrature
    need = demand + safety - on_hand - on_order
    pack = max(int(pack_size), 1)
    qty = math.ceil(round(need / pack, 6)) * pack if trigger and need > 0 else 0

    return Reorder(
        decision="REORDER" if qty > 0 else "HOLD",
        qty=qty,
        cash_required=round(qty * unit_cost, 2),
        days_of_cover=round(cover, 2) if cover is not None else None,
        reason={
            "on_hand": on_hand,
            "on_order": on_order,
            "forecast_daily_demand": round(daily, 3),
            "days_of_cover": round(cover, 2) if cover is not None else None,
            "lead_time_days": lead_time_days,
            "review_days": review_days,
            "demand_over_lead_and_review": round(demand, 2),
            "safety_stock": round(safety, 2),
            "units_needed": round(need, 2),
            "pack_size": pack,
            "unit_cost": unit_cost,
        },
    )
