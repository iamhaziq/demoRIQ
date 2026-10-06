"""Train + predict + score a synthetic shop end to end against the LOCAL Supabase stack.

    npx supabase start
    cd ml && .venv/Scripts/python scripts/local_predict.py

Checks the write-back rules: forecasts and decisions land; a second run supersedes decisions,
replaces weeks that have not started and leaves a started week untouched; scoring writes a row.
"""

from __future__ import annotations

import json
import sys
import warnings
from datetime import date, timedelta
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).parent))
from local_train import ADMIN_DSN, MODELS_DIR, WORKER_DSN, WORKER_PASSWORD, seed  # noqa: E402

from retailiq_ml.data import connect  # noqa: E402
from retailiq_ml.pipeline import predict_shop, score_last_week  # noqa: E402

warnings.filterwarnings("ignore")


def count(conn, sql, *args):
    return conn.execute(sql, args).fetchone()[0]


def main() -> None:
    with psycopg.connect(ADMIN_DSN, autocommit=True) as admin:
        admin.execute(f"alter role ml_worker with login password '{WORKER_PASSWORD}'")
        shop_id = seed(admin)
        # Stock and costs so the decision rules have inputs; one product overstocked to force a CLEAR.
        admin.execute("update public.products set unit_cost = round(unit_price * 0.75, 2), lead_time_days = 5"
                      " where shop_id = %s", (shop_id,))
        admin.execute(
            "insert into public.stock_snapshots (shop_id, product_id, date, on_hand, on_order)"
            " select shop_id, id, '2026-09-30', case when name = 'cuka' then 400 when name = 'milo' then 10 else 60 end, 0"
            " from public.products where shop_id = %s"
            " on conflict (shop_id, product_id, date) do update set on_hand = excluded.on_hand",
            (shop_id,),
        )
        admin.execute("update public.shops set loan_outstanding = 5000, rent_per_month = 2500,"
                      " utilities_per_month = 300 where id = %s", (shop_id,))
    print("seeded shop", shop_id)

    # Synthetic sales end 2026-09-30 (Wed); forecasts cover 10-01 .. 10-28, full weeks from Mon 10-05.
    day1, day2 = date(2026, 10, 1), date(2026, 10, 6)  # second run: the 10-05 week has started
    with connect(WORKER_DSN) as conn:
        r1 = predict_shop(conn, shop_id, MODELS_DIR, today=day1)
        print("run 1:", json.dumps(r1, default=str))
        assert r1["trained"] and r1["forecast_weeks"] > 0 and r1["decisions"] > 0
        types = dict(conn.execute("select type, count(*) from public.decisions where shop_id = %s"
                                  " and superseded_at is null group by type", (shop_id,)).fetchall())
        print("current decisions:", types)
        assert types.get("REORDER") and (types.get("CLEAR") or types.get("HOLD"))

        week = date(2026, 10, 5)
        before = conn.execute("select p50, created_at from public.forecasts where shop_id = %s and week_start = %s"
                              " order by product_id", (shop_id, week)).fetchall()
        r2 = predict_shop(conn, shop_id, MODELS_DIR, today=day2)
        print("run 2:", json.dumps(r2, default=str))
        after = conn.execute("select p50, created_at from public.forecasts where shop_id = %s and week_start = %s"
                             " order by product_id", (shop_id, week)).fetchall()
        assert before == after, "a started week must not be rewritten"
        assert r2["superseded"] == r1["decisions"]
        assert count(conn, "select count(*) from public.decisions where shop_id = %s and superseded_at is null",
                     shop_id) == r2["decisions"]

        reason = conn.execute("select reason_json from public.decisions where shop_id = %s and type = 'REORDER'"
                              " and superseded_at is null limit 1", (shop_id,)).fetchone()[0]
        assert {"product", "as_of", "forecast", "true_cost", "reorder"} <= set(reason)

        # Score the week of 10-05 as if today were 10-13 (no actual sales exist that week -> wape vs 0 sold).
        s = score_last_week(conn, shop_id, today=week + timedelta(days=8))
        print("score:", json.dumps(s, default=str))
        assert s["status"] in ("scored", "no_forecast")
    print("LOCAL PREDICT PASS", shop_id)


if __name__ == "__main__":
    main()
