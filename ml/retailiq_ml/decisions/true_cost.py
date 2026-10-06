"""True Cost of Stock and the hold-or-clear rule (docs/decisions.md). Pure functions."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass

DAYS_PER_YEAR = 365
DISCOUNT_STEPS = (10, 20, 30)  # percent
CLEARANCE_SELL_THROUGH = 0.8  # assumed share sold during a clearance (no price-response model yet)


def r2(x: float) -> float:
    return round(x + 0.0, 2)


@dataclass(frozen=True)
class ShopRates:
    """Annual rates as fractions (0.08 = 8%)."""

    loan_rate: float
    opportunity_rate: float
    service_rate: float
    financed_share: float  # share of stock value bought with borrowed money


def financed_share(loan_outstanding: float, shop_stock_value: float) -> float:
    if shop_stock_value <= 0 or loan_outstanding <= 0:
        return 0.0
    return min(1.0, loan_outstanding / shop_stock_value)


def storage_cost_annual(rent_per_month: float, utilities_per_month: float, storage_share: float) -> float:
    return (rent_per_month + utilities_per_month) * 12 * storage_share


def space_costs(storage_annual: float, units: Mapping[str, float], space_per_unit: Mapping[str, float]) -> dict[str, float]:
    """Split the storage cost across products by units on hand x shelf space per unit."""
    weights = {k: max(units[k], 0) * space_per_unit.get(k, 1.0) for k in units}
    total = sum(weights.values())
    return {k: (storage_annual * w / total if total else 0.0) for k, w in weights.items()}


@dataclass
class TrueCost:
    value: float
    components: dict[str, float]  # annual RM per part
    annual: float
    rate: float  # annual cost / value
    per_day: float
    per_unit_per_day: float  # RM, 4 dp
    reason: dict


def true_cost(units: float, unit_cost: float, rates: ShopRates, risk_rate: float, space_annual: float) -> TrueCost:
    value = units * unit_cost
    raw = {
        "financing": value * rates.financed_share * rates.loan_rate,
        "space": space_annual,
        "service": value * rates.service_rate,
        "risk": value * risk_rate,
        "opportunity": value * (1 - rates.financed_share) * rates.opportunity_rate,
    }
    annual = sum(raw.values())
    per_day = annual / DAYS_PER_YEAR
    per_unit_per_day = round(per_day / units, 4) if units > 0 else 0.0
    components = {k: r2(v) for k, v in raw.items()}
    return TrueCost(
        value=r2(value),
        components=components,
        annual=r2(annual),
        rate=round(annual / value, 4) if value else 0.0,
        per_day=r2(per_day),
        per_unit_per_day=per_unit_per_day,
        reason={
            "units": units,
            "unit_cost": unit_cost,
            "stock_value": r2(value),
            "rates": {**asdict(rates), "risk_rate": risk_rate},
            "space_cost_annual": r2(space_annual),
            "components_annual": components,
            "annual_cost": r2(annual),
            "cost_per_day": r2(per_day),
            "cost_per_unit_per_day": per_unit_per_day,
        },
    )


@dataclass
class HoldOrClear:
    decision: str  # "CLEAR" or "HOLD"
    discount_pct: int | None
    break_even_discount_pct: float
    clear_at_any_discount: bool
    holding_cost_per_unit: float
    holding_cost_total: float
    cash_released: float
    interest_avoided_per_year: float
    reason: dict


def hold_or_clear(
    units: float,
    unit_price: float,
    cost_per_unit_per_day: float,
    holding_days: int,
    expected_sold: float,
    loan_rate: float,
    clearance_sell_through: float = CLEARANCE_SELL_THROUGH,
    steps: tuple[int, ...] = DISCOUNT_STEPS,
) -> HoldOrClear:
    """Clear when the discount needed is smaller than the cost of waiting until the next season."""
    holding_per_unit = cost_per_unit_per_day * holding_days
    sold = min(max(expected_sold, 0.0), units)
    never_sold = 1 - sold / units if units > 0 else 0.0
    break_even = (never_sold + holding_per_unit / unit_price) * 100 if unit_price > 0 else 100.0
    any_discount = break_even >= 100
    below = [s for s in steps if s < break_even]
    step = below[0] if below else None
    decision = "CLEAR" if never_sold > 0 and step is not None else "HOLD"

    # Cash figures assume the recommended step, or the smallest step when holding is better
    # (what clearing would release anyway; as in the deck).
    discount = step if step is not None else steps[0]
    cash = units * unit_price * (1 - discount / 100) * clearance_sell_through
    return HoldOrClear(
        decision=decision,
        discount_pct=step,
        break_even_discount_pct=round(break_even, 1),
        clear_at_any_discount=any_discount,
        holding_cost_per_unit=r2(holding_per_unit),
        holding_cost_total=r2(holding_per_unit * units),
        cash_released=r2(cash),
        interest_avoided_per_year=r2(cash * loan_rate),
        reason={
            "units": units,
            "unit_price": unit_price,
            "holding_days": holding_days,
            "cost_per_unit_per_day": cost_per_unit_per_day,
            "holding_cost_per_unit": r2(holding_per_unit),
            "expected_sold_without_discount": round(sold, 1),
            "share_never_sold": round(never_sold, 4),
            "break_even_discount_pct": round(break_even, 1),
            "discount_steps": list(steps),
            "clearance_sell_through_assumed": clearance_sell_through,
            "cash_released_at_discount_pct": discount,
            "loan_rate": loan_rate,
        },
    )
