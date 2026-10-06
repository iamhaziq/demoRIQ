"""Read one shop's clean data from Supabase Postgres as the ml_worker role.
Every query filters by shop_id."""

from __future__ import annotations

import os
from dataclasses import dataclass

import pandas as pd
import psycopg


@dataclass
class ShopData:
    sales: pd.DataFrame  # product_id, date, qty, revenue
    stock: pd.DataFrame  # product_id, date, on_hand, on_order
    products: pd.DataFrame  # product_id, name, sku, category, unit_cost, unit_price, lead_time_days, pack_size,
    #                         shelf_space, risk_rate_pct, holding_days
    holidays: pd.DataFrame  # date, name, kind


def connect(dsn: str | None = None) -> psycopg.Connection:
    """DATABASE_URL is the ml_worker connection string (Modal secret retailiq-supabase)."""
    return psycopg.connect(dsn or os.environ["DATABASE_URL"], autocommit=True)


def _frame(conn, sql: str, params: tuple, columns: list[str], dates=("date",)) -> pd.DataFrame:
    df = pd.DataFrame(conn.execute(sql, params).fetchall(), columns=columns)
    for c in dates:
        if c in df:
            df[c] = pd.to_datetime(df[c])
    return df


def load_shop(conn, shop_id: str) -> ShopData:
    sales = _frame(
        conn,
        "select product_id::text, date, qty::float8, revenue::float8 from public.sales where shop_id = %s",
        (shop_id,),
        ["product_id", "date", "qty", "revenue"],
    )
    stock = _frame(
        conn,
        "select product_id::text, date, on_hand::float8, on_order::float8"
        " from public.stock_snapshots where shop_id = %s",
        (shop_id,),
        ["product_id", "date", "on_hand", "on_order"],
    )
    products = _frame(
        conn,
        "select id::text, name, sku, category, unit_cost::float8, unit_price::float8, lead_time_days, pack_size,"
        " shelf_space::float8, risk_rate_pct::float8, holding_days"
        " from public.products where shop_id = %s",
        (shop_id,),
        ["product_id", "name", "sku", "category", "unit_cost", "unit_price", "lead_time_days", "pack_size",
         "shelf_space", "risk_rate_pct", "holding_days"],
    )
    holidays = _frame(conn, "select date, name, kind from public.holidays", (), ["date", "name", "kind"])
    return ShopData(sales, stock, products, holidays)


SHOP_SETTINGS = (
    "loan_rate_pct", "opportunity_rate_pct", "service_rate_pct", "risk_rate_pct", "loan_outstanding",
    "rent_per_month", "utilities_per_month", "storage_share_of_rent", "holding_days", "review_days",
)


def load_settings(conn, shop_id: str) -> dict:
    """The shop's True Cost settings (docs/decisions.md), as floats/ints."""
    row = conn.execute(
        f"select {', '.join(SHOP_SETTINGS)} from public.shops where id = %s", (shop_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"shop {shop_id} not found")
    return {k: (int(v) if k in ("holding_days", "review_days") else float(v)) for k, v in zip(SHOP_SETTINGS, row)}


def latest_stock(stock: pd.DataFrame) -> pd.DataFrame:
    """Most recent snapshot per product: product_id, date, on_hand, on_order."""
    if stock.empty:
        return pd.DataFrame(columns=["product_id", "date", "on_hand", "on_order"])
    return stock.sort_values("date").groupby("product_id", as_index=False).tail(1).reset_index(drop=True)


def active_shops(conn) -> list[str]:
    rows = conn.execute("select id::text from public.shops where is_active order by created_at").fetchall()
    return [r[0] for r in rows]


def set_job(conn, job_id: str | None, status: str, error: str | None = None) -> None:
    """Update an ml_jobs row (no-op without a job id, e.g. manual runs)."""
    if not job_id:
        return
    conn.execute(
        "update public.ml_jobs set status = %s, error = %s,"
        " started_at = case when %s = 'running' then now() else started_at end,"
        " finished_at = case when %s in ('succeeded', 'failed') then now() else finished_at end"
        " where id = %s",
        (status, error, status, status, job_id),
    )
