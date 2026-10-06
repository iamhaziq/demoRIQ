"""Smoke test of the deployed stack: a synthetic TEST shop on the HOSTED project, trained and
predicted by the deployed Modal app, results checked through the REST API.

    cd ml && .venv/Scripts/python scripts/hosted_smoke.py

Uses the service-role key fetched at runtime via the Supabase CLI login (held in memory only).
Idempotent: reuses the test user/shop and only seeds data once. Delete the user
smoke-test@retailiq.invalid in the dashboard to remove everything it created.
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request

import modal

from retailiq_ml.synthetic import make_shop

REF = "nbwcsfzixoymloiqkwvd"
BASE = f"https://{REF}.supabase.co"
EMAIL = "smoke-test@retailiq.invalid"


def service_key() -> str:
    out = subprocess.run(["npx.cmd" if sys.platform == "win32" else "npx", "supabase", "projects", "api-keys",
                          "--project-ref", REF, "-o", "json"], capture_output=True, text=True, check=True).stdout
    keys = json.loads(out)
    return next(k["api_key"] for k in keys if k.get("name") == "service_role" or k.get("type") == "secret")


KEY = service_key()
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def call(method: str, path: str, body=None, prefer: str | None = None):
    headers = {**H, **({"Prefer": prefer} if prefer else {})}
    req = urllib.request.Request(BASE + path, method=method, headers=headers,
                                 data=json.dumps(body, default=str).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode()
            return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}") from None


def test_shop() -> str:
    users = call("GET", "/auth/v1/admin/users?per_page=1000")["users"]
    user = next((u for u in users if u["email"] == EMAIL), None)
    if user is None:
        user = call("POST", "/auth/v1/admin/users", {"email": EMAIL, "email_confirm": True,
                                                     "password": __import__("uuid").uuid4().hex})
    shop = call("GET", f"/rest/v1/shops?owner_user_id=eq.{user['id']}&select=id")[0]
    call("PATCH", f"/rest/v1/shops?id=eq.{shop['id']}", {"name": "TEST shop (synthetic, smoke test)",
                                                         "loan_outstanding": 5000, "rent_per_month": 2500,
                                                         "utilities_per_month": 300})
    return shop["id"]


def seed(shop_id: str) -> None:
    if call("GET", f"/rest/v1/products?shop_id=eq.{shop_id}&select=id&limit=1"):
        print("test shop already seeded")
        return
    sales, _stock, products = make_shop(days=200)
    rows = call("POST", "/rest/v1/products", [
        {"shop_id": shop_id, "name": p.product_id, "category": p.category, "unit_price": p.unit_price,
         "unit_cost": round(p.unit_price * 0.75, 2), "lead_time_days": 5} for p in products.itertuples()
    ], prefer="return=representation")
    ids = {r["name"]: r["id"] for r in rows}
    sale_rows = [{"shop_id": shop_id, "product_id": ids[r.product_id], "date": r.date.date().isoformat(),
                  "qty": r.qty, "revenue": r.revenue} for r in sales.itertuples()]
    for i in range(0, len(sale_rows), 500):
        call("POST", "/rest/v1/sales", sale_rows[i:i + 500], prefer="return=minimal")
    call("POST", "/rest/v1/stock_snapshots", [
        {"shop_id": shop_id, "product_id": pid, "date": "2026-09-30",
         "on_hand": 400 if name == "cuka" else 10 if name == "milo" else 60, "on_order": 0}
        for name, pid in ids.items()
    ], prefer="return=minimal")
    print(f"seeded {len(ids)} products, {len(sale_rows)} sales rows")


def main() -> None:
    shop_id = test_shop()
    print("test shop", shop_id)
    seed(shop_id)
    run_shop = modal.Function.from_name("retailiq-ml", "run_shop")
    result = run_shop.remote(shop_id, "predict", None)
    print("modal run_shop:", json.dumps(result, default=str))
    mv = call("GET", f"/rest/v1/model_versions?shop_id=eq.{shop_id}&select=version,model_type,wape,status")
    fc = call("GET", f"/rest/v1/forecasts?shop_id=eq.{shop_id}&select=week_start")
    de = call("GET", f"/rest/v1/decisions?shop_id=eq.{shop_id}&superseded_at=is.null&select=type,qty,value_rm")
    print("model_versions:", mv)
    print(f"forecast rows: {len(fc)}; current decisions: {de}")
    assert result["status"] == "predicted" and fc and de, "smoke test failed"
    print("HOSTED SMOKE PASS")


if __name__ == "__main__":
    main()
