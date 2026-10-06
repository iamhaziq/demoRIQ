"""Email alerts via the Resend API (retailiq-alerts Modal secret: RESEND_API_KEY, ALERT_EMAIL).
Without the secret (local runs) alerts are printed instead of sent."""

from __future__ import annotations

import json
import os
import urllib.request
from collections.abc import Callable

RESEND_URL = "https://api.resend.com/emails"
SENDER = "RetailIQ alerts <onboarding@resend.dev>"  # Resend's test sender: delivers to the account owner


def _post(url: str, headers: dict, body: dict) -> int:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.status


def send_alert(subject: str, lines: list[str], post: Callable[[str, dict, dict], int] = _post) -> bool:
    """Returns True if an email was sent. Never raises: an alert failure must not fail the ML job."""
    key, to = os.environ.get("RESEND_API_KEY"), os.environ.get("ALERT_EMAIL")
    text = "\n".join(lines)
    if not key or not to:
        print(f"[alert not sent: no RESEND_API_KEY/ALERT_EMAIL] {subject}\n{text}")
        return False
    try:
        status = post(RESEND_URL, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                      {"from": SENDER, "to": [to], "subject": f"[RetailIQ] {subject}", "text": text})
        return 200 <= status < 300
    except Exception as e:  # noqa: BLE001
        print(f"[alert failed: {type(e).__name__}: {e}] {subject}")
        return False


def batch_report(job: str, shop_ids: list[str], results: list) -> tuple[str, list[str]] | None:
    """Summarise a cron batch; None when nothing failed."""
    failed = [(s, r) for s, r in zip(shop_ids, results) if isinstance(r, BaseException)]
    if not failed:
        return None
    lines = [f"{job}: {len(failed)} of {len(shop_ids)} shops failed."]
    lines += [f"- shop {s}: {type(r).__name__}: {str(r)[:300]}" for s, r in failed]
    lines.append("Details are in the ml_jobs table and the Modal dashboard.")
    return f"{job} failed for {len(failed)} shop(s)", lines
