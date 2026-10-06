"""Daily panel: one row per product per day, zero-filled, with stock-out flags (docs/forecast.md)."""

from __future__ import annotations

import pandas as pd

LOW_CONFIDENCE_DAYS = 56  # under 8 weeks of history -> simple average, flagged

PANEL_COLUMNS = ["product_id", "date", "qty", "price", "stockout", "category"]


def build_panel(
    sales: pd.DataFrame,
    stock: pd.DataFrame | None = None,
    products: pd.DataFrame | None = None,
    as_of: pd.Timestamp | str | None = None,
) -> pd.DataFrame:
    """
    sales: product_id, date, qty[, revenue]. stock: product_id, date, on_hand.
    products: product_id[, category, unit_price]. as_of defaults to the last sales date.

    Days without a sales row are 0. A stock snapshot with on_hand == 0 marks a stock-out day.
    price = revenue / qty on days with sales, carried forward, else the product's unit_price.
    """
    if sales.empty:
        return pd.DataFrame(columns=PANEL_COLUMNS)

    s = sales.copy()
    s["date"] = pd.to_datetime(s["date"])
    as_of = pd.Timestamp(as_of) if as_of is not None else s["date"].max()
    s = s[s["date"] <= as_of]
    if "revenue" not in s:
        s["revenue"] = float("nan")

    day = s.groupby(["product_id", "date"], as_index=False).agg(
        qty=("qty", "sum"), revenue=("revenue", lambda r: r.sum(min_count=1))
    )

    first = day.groupby("product_id")["date"].min()
    grid = pd.concat(
        [pd.DataFrame({"product_id": pid, "date": pd.date_range(d0, as_of, freq="D")}) for pid, d0 in first.items()],
        ignore_index=True,
    )
    panel = grid.merge(day, on=["product_id", "date"], how="left")
    panel["qty"] = panel["qty"].fillna(0.0).astype(float)

    sold = panel["qty"] > 0
    panel["price"] = (panel["revenue"] / panel["qty"]).where(sold & panel["revenue"].notna())
    panel["price"] = panel.groupby("product_id")["price"].ffill()

    if products is not None and not products.empty:
        attrs = products.set_index("product_id")
        if "unit_price" in attrs:
            panel["price"] = panel["price"].fillna(panel["product_id"].map(attrs["unit_price"]))
        category = panel["product_id"].map(attrs["category"]) if "category" in attrs else None
    else:
        category = None
    panel["price"] = panel.groupby("product_id")["price"].bfill().astype(float)
    panel["category"] = (category if category is not None else pd.Series(index=panel.index, dtype=object))
    panel["category"] = panel["category"].fillna("unknown").astype(str)

    panel["stockout"] = False
    if stock is not None and not stock.empty:
        k = stock.copy()
        k["date"] = pd.to_datetime(k["date"])
        out = k.loc[k["on_hand"] <= 0, ["product_id", "date"]].drop_duplicates()
        out["stockout_flag"] = True
        panel = panel.merge(out, on=["product_id", "date"], how="left")
        panel["stockout"] = panel["stockout_flag"].fillna(False).astype(bool)
        panel = panel.drop(columns="stockout_flag")

    return panel[PANEL_COLUMNS].sort_values(["product_id", "date"]).reset_index(drop=True)


def history_days(panel: pd.DataFrame, as_of: pd.Timestamp | None = None) -> pd.Series:
    """Days of history per product, counting the first sale day and as_of."""
    as_of = pd.Timestamp(as_of) if as_of is not None else panel["date"].max()
    first = panel.groupby("product_id")["date"].min()
    return (as_of - first).dt.days + 1


def demand(panel: pd.DataFrame) -> pd.Series:
    """Target: qty, with stock-out days unknown (NaN), not zero."""
    return panel["qty"].where(~panel["stockout"])
