"""Synthetic shop data for tests and local runs. Deterministic for a given seed. Not real data."""

from __future__ import annotations

import numpy as np
import pandas as pd

DEFAULT_PRODUCTS = [
    # product_id, category, unit_price, daily base rate
    ("milo", "Minuman", 21.0, 6.0),
    ("gula", "Dapur", 2.85, 12.0),
    ("roti", "Roti", 3.5, 9.0),
    ("maggi", "Mi", 6.2, 4.0),
    ("cuka", "Dapur", 3.2, 0.25),  # slow, lumpy item
]

WEEKLY = np.array([0.85, 0.9, 0.9, 0.95, 1.1, 1.3, 1.0])  # Mon..Sun


def make_shop(
    days: int = 180,
    end: str = "2026-09-30",
    seed: int = 7,
    products=DEFAULT_PRODUCTS,
    stockout_days: int = 4,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Returns (sales, stock, products). Sales follow a weekly pattern, a payday lift
    (25th to 1st) and negative binomial noise; one short stock-out streak per product."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range(end=pd.Timestamp(end), periods=days, freq="D")
    payday = ((dates.day >= 25) | (dates.day == 1)).astype(float)
    rows, stock_rows = [], []
    for pid, _cat, price, base in products:
        mean = base * WEEKLY[dates.dayofweek] * (1 + 0.2 * payday)
        n = 3.0  # NB shape: variance = mean + mean^2 / n
        qty = rng.negative_binomial(n, n / (n + mean))
        start = int(rng.integers(20, days - stockout_days - 1))
        out = np.zeros(days, dtype=bool)
        out[start : start + stockout_days] = True
        qty = np.where(out, 0, qty)
        for d, q, o in zip(dates, qty, out):
            if q > 0:
                rows.append({"product_id": pid, "date": d, "qty": float(q), "revenue": round(q * price, 2)})
            if o:
                stock_rows.append({"product_id": pid, "date": d, "on_hand": 0.0})
    prods = pd.DataFrame(
        [{"product_id": p, "category": c, "unit_price": pr} for p, c, pr, _ in products]
    )
    return pd.DataFrame(rows), pd.DataFrame(stock_rows, columns=["product_id", "date", "on_hand"]), prods


def make_holidays() -> pd.DataFrame:
    return pd.DataFrame(
        [
            ("2026-03-21", "Hari Raya Aidilfitri", "festival"),
            ("2026-03-22", "Hari Raya Aidilfitri", "festival"),
            ("2027-03-10", "Hari Raya Aidilfitri", "festival"),
            ("2026-02-17", "Chinese New Year", "festival"),
            ("2027-02-06", "Chinese New Year", "festival"),
            ("2026-11-08", "Deepavali", "festival"),
            ("2026-08-31", "National Day", "public"),
            ("2026-09-16", "Malaysia Day", "public"),
            ("2026-12-25", "Christmas", "public"),
        ],
        columns=["date", "name", "kind"],
    ).assign(date=lambda d: pd.to_datetime(d["date"]))
