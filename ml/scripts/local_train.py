"""Train a synthetic shop end to end against the LOCAL Supabase stack (never production).

    npx supabase start
    cd ml && .venv/Scripts/python scripts/local_train.py

Seeds a shop with synthetic data as the local superuser, enables the ml_worker login with a
local-only password, then runs pipeline.train_shop twice as ml_worker (the second run tests the
promotion rule against the first champion). Model artifacts go to ml/.local_models/.
"""

from __future__ import annotations

import json
import uuid
import warnings
from pathlib import Path

import psycopg

from retailiq_ml.data import connect
from retailiq_ml.pipeline import train_shop
from retailiq_ml.synthetic import make_shop

warnings.filterwarnings("ignore")

ADMIN_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
WORKER_PASSWORD = "local-dev-only"
WORKER_DSN = f"postgresql://ml_worker:{WORKER_PASSWORD}@127.0.0.1:54322/postgres"
MODELS_DIR = Path(__file__).parents[1] / ".local_models"


def seed(admin) -> str:
    user_id = str(uuid.uuid4())
    admin.execute("insert into auth.users (id, email) values (%s, %s)", (user_id, f"ml-{user_id[:8]}@test.my"))
    (shop_id,) = admin.execute("select id::text from public.shops where owner_user_id = %s", (user_id,)).fetchone()

    sales, stock, products = make_shop(days=200)
    ids = {}
    for p in products.itertuples():
        (pid,) = admin.execute(
            "insert into public.products (shop_id, name, category, unit_price) values (%s, %s, %s, %s)"
            " returning id::text",
            (shop_id, p.product_id, p.category, p.unit_price),
        ).fetchone()
        ids[p.product_id] = pid
    with admin.cursor() as cur:
        cur.executemany(
            "insert into public.sales (shop_id, product_id, date, qty, revenue) values (%s, %s, %s, %s, %s)",
            [(shop_id, ids[r.product_id], r.date.date(), r.qty, r.revenue) for r in sales.itertuples()],
        )
        cur.executemany(
            "insert into public.stock_snapshots (shop_id, product_id, date, on_hand) values (%s, %s, %s, %s)",
            [(shop_id, ids[r.product_id], r.date.date(), r.on_hand) for r in stock.itertuples()],
        )
    return shop_id


def main() -> None:
    with psycopg.connect(ADMIN_DSN, autocommit=True) as admin:
        if "127.0.0.1" not in ADMIN_DSN:
            raise SystemExit("local stack only")
        admin.execute(f"alter role ml_worker with login password '{WORKER_PASSWORD}'")
        shop_id = seed(admin)
    print("seeded shop", shop_id)

    with connect(WORKER_DSN) as conn:
        for run in (1, 2):
            result = train_shop(conn, shop_id, MODELS_DIR)
            print(f"run {run}:", json.dumps(result, indent=2, default=str))
        rows = conn.execute(
            "select version, model_type, round(wape, 4), status from public.model_versions"
            " where shop_id = %s order by version",
            (shop_id,),
        ).fetchall()
    print("model_versions:", rows)


if __name__ == "__main__":
    main()
